"use client";

import {
  Alert,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TablePagination,
  TableRow,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import LatestVolatilityPointRow from "./LatestVolatilityPointRow";
import entrySequenceCandidates from "@/components/dashboard/entry/entry-sequence-candidates";
import CoinTagComposition from "./CoinTagComposition";
import type { LatestVolatilityPointsProps } from "./types";
import VolatilityPointLabelFrequencyBar from "./VolatilityPointLabelFrequencyBar";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { SortKey } from "./columns";
import { COLUMNS, getLatestVolatilityPointColumnHelp } from "./columns";
import type { LatestVolatilityPointControls } from "./controls";
import {
  normalizeSymbolSearch,
  readControls,
  ROWS_PER_PAGE_OPTIONS,
  writeControls,
} from "./controls";
import { FilterControls } from "./FilterControls";
import { formatMissingVolatilitySymbols } from "./missing-symbols";
import { useVolatilityRows } from "./useVolatilityRows";
import { VolatilityTableHead } from "./VolatilityTableHead";

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
  const {
    configuredLabelFrequency,
    configuredSymbols,
    displayableRows,
    missingVolatilitySymbols,
    rows,
  } = useVolatilityRows({
    coinDescriptions,
    coinTags,
    dashboardState,
    fundingRateBySymbol,
    marketCapFetchedAtBySymbol,
    marketCapUSDBySymbol,
    selectedTags,
    sortDirection,
    sortKey,
    symbolSearch,
    volatilityMap,
    volume24hBySymbol,
  });
  const canDeleteAnotherCoin = configuredSymbols.size > 1;
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

            <FilterControls
              availableTags={availableTags}
              selectedTags={selectedTags}
              setControls={setControls}
              setPage={setPage}
              setSymbolSearchDraft={setSymbolSearchDraft}
              symbolSearchDraft={symbolSearchDraft}
              tagColors={tagColors}
              tagDescriptions={tagDescriptions}
            />

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
                  <VolatilityTableHead
                    columnHelpByKey={columnHelpByKey}
                    onSort={changeSort}
                    resolvedMaxEntryAbsLevel={resolvedMaxEntryAbsLevel}
                    resolvedMinEntryAbsLevel={resolvedMinEntryAbsLevel}
                    sortDirection={sortDirection}
                    sortKey={sortKey}
                  />
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
