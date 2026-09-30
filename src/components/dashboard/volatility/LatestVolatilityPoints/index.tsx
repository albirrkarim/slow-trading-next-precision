"use client";

import CoinTagSelect from "@/components/coins/CoinTagSelect";

import ClearIcon from "@mui/icons-material/Clear";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  IconButton,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import LatestVolatilityPointRow from "./LatestVolatilityPointRow";
import entrySequenceCandidates from "@/components/dashboard/entry/entry-sequence-candidates";
import CoinTagComposition from "./CoinTagComposition";
import type { LatestVolatilityPointsProps } from "./types";
import { estimateMaxEntryFromVolume24h } from "./volume";
import VolatilityPointLabelFrequencyBar from "./VolatilityPointLabelFrequencyBar";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import { runtimeEntrySequences } from "@/lib/system/trading";
import type { LatestVolatilityPointTableRow, SortKey } from "./columns";
import { COLUMNS, getLatestVolatilityPointColumnHelp } from "./columns";
import type { LatestVolatilityPointControls } from "./controls";
import {
  matchesLatestVolatilitySymbolSearch,
  normalizeSymbolSearch,
  readControls,
  ROWS_PER_PAGE_OPTIONS,
  SYMBOL_SEARCH_MAX_LENGTH,
  writeControls,
} from "./controls";
import {
  formatMissingVolatilitySymbols,
  getMissingVolatilitySymbols,
} from "./missing-symbols";
import {
  countConfiguredVolatilityPointLabels,
  countVolatilityLevels,
  countVolatilityPointLabels,
} from "./stats";
import { compareLatestVolatilityPointRows } from "./sort";

export {
  buildConfiguredCoinTagComposition,
  buildConfiguredCoinTagCompositionGroups,
} from "./CoinTagComposition";
export { isVolatilityPointUsedByAccount, simplifyId } from "./utils";
export { formatMarketCapUpdatedAt } from "./LatestVolatilityPointRow";
export {
  describeFundingRatePayer,
  formatFundingRatePct,
  formatFundingRateUpdatedAt,
} from "./FundingRateCell";
export {
  buildMaxEntryVolumeTooltip,
  estimateMaxEntryFromVolume24h,
  formatVolume24h,
  getEstimatedMaxEntryRiskColor,
  getVolume24hRiskColor,
  isLowVolume24h,
  isVeryLowVolume24h,
} from "./volume";
export type {
  LatestVolatilityPointsProps,
  VolatilityPointLabelFrequency,
} from "./types";
export { getLatestVolatilityPointColumnHelp } from "./columns";
export { matchesLatestVolatilitySymbolSearch } from "./controls";
export { getMissingVolatilitySymbols } from "./missing-symbols";
export {
  countConfiguredVolatilityPointLabels,
  countVolatilityLevels,
  countVolatilityPointLabels,
} from "./stats";
export { compareLatestVolatilityPointRows } from "./sort";

/**
 * Display the latest volatility point for each configured symbol.
 * Created: 05 Dec 2025
 */

export default function LatestVolatilityPoints({
  availableTags,
  coinDescriptions,
  coinTags,
  volatilityMap,
  dashboardState,
  deletingSymbol,
  enteringSymbol,
  fundingRateBySymbol,
  marketCapFetchedAtBySymbol,
  marketCapUSDBySymbol,
  onDeleteCoin,
  onManualEntry,
  onCoinDescriptionChange,
  onCoinTagsChange,
  openSymbols = [],
  tagManagerAction,
  tagColors,
  tagDescriptions,
  volume24hBySymbol,
}: LatestVolatilityPointsProps) {
  const isMobile = useMediaQuery("(max-width:600px)");
  const [controls, setControls] =
    useState<LatestVolatilityPointControls>(readControls);
  const [symbolSearchDraft, setSymbolSearchDraft] = useState(
    controls.symbolSearch,
  );
  const [page, setPage] = useState(0);
  const { rowsPerPage, selectedTags, sortDirection, sortKey, symbolSearch } =
    controls;

  useEffect(() => {
    writeControls(controls);
  }, [controls]);

  useEffect(() => {
    const nextSearch = normalizeSymbolSearch(symbolSearchDraft);
    if (nextSearch === symbolSearch) return undefined;

    const timeoutId = window.setTimeout(() => {
      setPage(0);
      setControls((current) =>
        current.symbolSearch === nextSearch
          ? current
          : { ...current, symbolSearch: nextSearch },
      );
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [symbolSearch, symbolSearchDraft]);

  const normalizedOpenSymbols = useMemo(
    () => new Set(openSymbols.map((symbol) => symbol.trim().toUpperCase())),
    [openSymbols],
  );
  const configuredSymbols = useMemo(
    () =>
      new Set(
        dashboardState.config.symbols.map((symbol) =>
          symbol.trim().toUpperCase(),
        ),
      ),
    [dashboardState.config.symbols],
  );
  const missingVolatilitySymbols = useMemo(
    () =>
      getMissingVolatilitySymbols({
        configuredSymbols: dashboardState.config.symbols,
        volatilityMap,
      }),
    [dashboardState.config.symbols, volatilityMap],
  );
  const canDeleteAnotherCoin = configuredSymbols.size > 1;
  const selectedTagKeys = useMemo(
    () => selectedTags.map((tag) => tag.toLocaleLowerCase()),
    [selectedTags],
  );
  const configuredLabelFrequency = useMemo(
    () =>
      countConfiguredVolatilityPointLabels({
        configuredSymbols,
        volatilityMap,
      }),
    [configuredSymbols, volatilityMap],
  );
  const resolvedMinEntryAbsLevel =
    entrySequenceCandidates.threshold.resolve(
      dashboardState.config.minEntryAbsLevel,
    );
  const resolvedMaxEntryAbsLevel =
    entrySequenceCandidates.threshold.resolveMax(
      dashboardState.config.maxEntryAbsLevel,
    );
  const columnHelpByKey = useMemo(
    () =>
      new Map(
        getLatestVolatilityPointColumnHelp(
          resolvedMinEntryAbsLevel,
          resolvedMaxEntryAbsLevel,
        ).map((column) => [column.key, column]),
      ),
    [resolvedMinEntryAbsLevel, resolvedMaxEntryAbsLevel],
  );
  const displayableRows = useMemo(() => {
    const entrySequenceCounts = runtimeEntrySequences.count({
      entrySignals: entrySequenceCandidates.build({
        minEntryAbsLevel:
          dashboardState.config.minEntryAbsLevel,
        maxEntryAbsLevel:
          dashboardState.config.maxEntryAbsLevel,
        volatilityMap,
      }),
      volatilityMap,
    });
    const maxEntryBased24HourVolPct =
      dashboardState.config.maxEntryBased24HourVolPct ?? 0.2;
    const entrySequenceCountBySymbol = new Map(
      entrySequenceCounts.map((item) => [item.symbol, item]),
    );

    return Object.entries(volatilityMap).flatMap(
      ([symbol, points], index): LatestVolatilityPointTableRow[] => {
        const latestPoint = points.at(-1);
        if (!latestPoint) return [];

        const normalizedSymbol = symbol.trim().toUpperCase();
        if (!configuredSymbols.has(normalizedSymbol)) return [];

        const volume24h = volume24hBySymbol[normalizedSymbol];
        const fundingRate = fundingRateBySymbol[normalizedSymbol];
        const marketCapFetchedAt =
          marketCapFetchedAtBySymbol[normalizedSymbol];
        const marketCapUSD = marketCapUSDBySymbol[normalizedSymbol];

        return [
          {
            descriptionText: coinDescriptions[normalizedSymbol] ?? "",
            entrySequenceCount: entrySequenceCountBySymbol.get(
              normalizedSymbol,
            ) ?? {
              long: 0,
              short: 0,
              symbol: normalizedSymbol,
              total: 0,
            },
            estimatedMaxEntry: estimateMaxEntryFromVolume24h({
              maxEntryBased24HourVolPct,
              volume24h,
            }),
            fundingRate,
            index,
            levelFrequency: countVolatilityLevels(points),
            labelFrequency: countVolatilityPointLabels(points),
            marketCapFetchedAt,
            marketCapUSD,
            point: latestPoint,
            pointCount: points.length,
            symbol: normalizedSymbol,
            volume24h,
          },
        ];
      },
    );
  }, [
    coinDescriptions,
    configuredSymbols,
    dashboardState.config.maxEntryBased24HourVolPct,
    dashboardState.config.minEntryAbsLevel,
    dashboardState.config.maxEntryAbsLevel,
    fundingRateBySymbol,
    marketCapFetchedAtBySymbol,
    marketCapUSDBySymbol,
    volatilityMap,
    volume24hBySymbol,
  ]);

  const rows = useMemo(() => {
    const filteredRows = displayableRows.filter((row) => {
      if (
        !matchesLatestVolatilitySymbolSearch({
          search: symbolSearch,
          symbol: row.symbol,
        })
      ) {
        return false;
      }

      if (selectedTagKeys.length === 0) return true;
      const tagKeys = new Set(
        (coinTags[row.symbol] ?? []).map((tag) => tag.toLocaleLowerCase()),
      );
      return selectedTagKeys.every((tag) => tagKeys.has(tag));
    });

    return [...filteredRows].sort((left, right) => {
      const result = compareLatestVolatilityPointRows(left, right, sortKey);
      return sortDirection === "asc" ? result : -result;
    });
  }, [
    coinTags,
    displayableRows,
    selectedTagKeys,
    sortDirection,
    sortKey,
    symbolSearch,
  ]);

  const countLabel =
    selectedTags.length > 0 || symbolSearch
      ? `${rows.length}/${displayableRows.length}`
      : rows.length.toLocaleString();
  const maxPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, maxPage);
  const paginatedRows = useMemo(() => {
    const start = currentPage * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [currentPage, rows, rowsPerPage]);

  const changeSort = (nextKey: SortKey) => {
    setPage(0);
    setControls((current) =>
      nextKey === current.sortKey
        ? {
          ...current,
          sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
        }
        : { ...current, sortDirection: "asc", sortKey: nextKey },
    );
  };

  return (
    <HeaderMetrics
      defaultExpanded={!isMobile}
      headerCanBeClicked
      rememberExpand="latest-volatility-points"
      title={
        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
          Latest Volatility Points ({countLabel})
        </Typography>
      }
    >
      {(expanded) =>
        expanded && (
          <Box>
            {tagManagerAction && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 1,
                  my: 1,
                }}
              >
                {tagManagerAction}

                <VolatilityPointLabelFrequencyBar
                  frequency={configuredLabelFrequency}
                  width={220}
                />
              </Box>
            )}

            <HeaderMetrics
              rememberExpand="latest-volatility-points:coin-tags-composition"
              headerCanBeClicked
              title="Coin tags composition"
              sx={{ my: 1 }}
            >
              {(expandedBelow) => (
                <>
                  {expandedBelow && (
                    <CoinTagComposition
                      coinTags={coinTags}
                      configuredSymbols={dashboardState.config.symbols}
                      tagColors={tagColors}
                      tagDescriptions={tagDescriptions}
                    />
                  )}
                </>
              )}
            </HeaderMetrics>

            <Box
              sx={{
                alignItems: "flex-end",
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(180px, 260px) 1fr",
                },
                mb: 1,
                maxWidth: 820,
              }}
            >
              <TextField
                fullWidth
                label="Search symbol"
                onChange={(event) => {
                  setSymbolSearchDraft(
                    event.target.value.slice(0, SYMBOL_SEARCH_MAX_LENGTH),
                  );
                }}
                placeholder="BTC or BTC, ETH, SOL"
                size="small"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: symbolSearchDraft ? (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="Clear symbol search"
                          edge="end"
                          onClick={() => {
                            setSymbolSearchDraft("");
                            setPage(0);
                            setControls((current) => ({
                              ...current,
                              symbolSearch: "",
                            }));
                          }}
                          size="small"
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
                value={symbolSearchDraft}
                variant="standard"
              />

              <CoinTagSelect
                allowCreate={false}
                label="Filter by tags"
                onChange={(nextTags) => {
                  setPage(0);
                  setControls((current) => ({
                    ...current,
                    selectedTags: nextTags,
                  }));
                }}
                options={availableTags}
                tagColors={tagColors}
                tagDescriptions={tagDescriptions}
                value={selectedTags}
              />
            </Box>

            {missingVolatilitySymbols.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {missingVolatilitySymbols.length} configured coin
                {missingVolatilitySymbols.length > 1 ? "s" : ""} have no
                volatility points and are hidden from this table:{" "}
                {formatMissingVolatilitySymbols(missingVolatilitySymbols)}
              </Alert>
            )}

            <Paper sx={{ mt: 1 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {COLUMNS.map((column) => {
                        const label =
                          column.key === "entrySequence"
                            ? `Entry sequences (${resolvedMinEntryAbsLevel === undefined ? "no min" : `abs >= ${resolvedMinEntryAbsLevel}`}${resolvedMaxEntryAbsLevel === undefined ? "" : `, abs <= ${resolvedMaxEntryAbsLevel}`})`
                            : column.label;
                        const help = columnHelpByKey.get(column.key);
                        const accessibleHelp = help
                          ? `${label}. Meaning: ${help.meaning} Source: ${help.source}`
                          : label;

                        return (
                          <TableCell key={column.key} width={column.width}>
                            <Tooltip
                              arrow
                              enterTouchDelay={0}
                              title={
                                help && (
                                  <Box sx={{ maxWidth: 360, py: 0.5 }}>
                                    <Typography
                                      component="p"
                                      sx={{ fontSize: "inherit", mb: 0.75 }}
                                    >
                                      <strong>Meaning:</strong> {help.meaning}
                                    </Typography>
                                    <Typography
                                      component="p"
                                      sx={{ fontSize: "inherit" }}
                                    >
                                      <strong>Source:</strong> {help.source}
                                    </Typography>
                                  </Box>
                                )
                              }
                            >
                              <TableSortLabel
                                active={sortKey === column.key}
                                aria-label={accessibleHelp}
                                direction={
                                  sortKey === column.key
                                    ? sortDirection
                                    : "asc"
                                }
                                onClick={() => changeSort(column.key)}
                              >
                                {label}
                                <HelpOutlineIcon
                                  aria-hidden
                                  sx={{
                                    color: "text.secondary",
                                    fontSize: 16,
                                    ml: 0.5,
                                  }}
                                />
                              </TableSortLabel>
                            </Tooltip>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedRows.map((row) => (
                      <LatestVolatilityPointRow
                        availableTags={availableTags}
                        canDeleteAnotherCoin={canDeleteAnotherCoin}
                        coinDescriptions={coinDescriptions}
                        coinTags={coinTags}
                        dashboardState={dashboardState}
                        deletingSymbol={deletingSymbol}
                        entrySequenceCount={row.entrySequenceCount}
                        enteringSymbol={enteringSymbol}
                        fundingRate={row.fundingRate}
                        index={row.index}
                        key={row.symbol}
                        labelFrequency={row.labelFrequency}
                        levelFrequency={row.levelFrequency}
                        marketCapFetchedAt={row.marketCapFetchedAt}
                        marketCapUSD={row.marketCapUSD}
                        normalizedOpenSymbols={normalizedOpenSymbols}
                        onCoinDescriptionChange={onCoinDescriptionChange}
                        onCoinTagsChange={onCoinTagsChange}
                        onDeleteCoin={onDeleteCoin}
                        onManualEntry={onManualEntry}
                        point={row.point}
                        pointCount={row.pointCount}
                        symbol={row.symbol}
                        tagColors={tagColors}
                        tagDescriptions={tagDescriptions}
                        volume24h={row.volume24h}
                      />
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell align="center" colSpan={COLUMNS.length}>
                          No latest volatility points match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={rows.length}
                onPageChange={(_event, nextPage) => setPage(nextPage)}
                onRowsPerPageChange={(event) => {
                  setPage(0);
                  setControls((current) => ({
                    ...current,
                    rowsPerPage: Number.parseInt(event.target.value, 10),
                  }));
                }}
                page={currentPage}
                rowsPerPage={rowsPerPage}
                rowsPerPageOptions={[...ROWS_PER_PAGE_OPTIONS]}
              />
            </Paper>
          </Box>
        )
      }
    </HeaderMetrics>
  );
}
