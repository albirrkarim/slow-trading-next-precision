"use client";

import { useMemo } from "react";

import entrySequenceCandidates from "@/components/dashboard/entry/entry-sequence-candidates";
import { runtimeEntrySequences } from "@/lib/system/trading";

import type { LatestVolatilityPointTableRow } from "./columns";
import {
  matchesLatestVolatilitySymbolSearch,
} from "./controls";
import type { LatestVolatilityPointControls } from "./controls";
import { getMissingVolatilitySymbols } from "./missing-symbols";
import {
  countConfiguredVolatilityPointLabels,
  countVolatilityLevels,
  countVolatilityPointLabels,
} from "./stats";
import { compareLatestVolatilityPointRows } from "./sort";
import type { LatestVolatilityPointsProps } from "./types";
import { estimateMaxEntryFromVolume24h } from "./volume";

export function useVolatilityRows({
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
}: Pick<
  LatestVolatilityPointsProps,
  | "coinDescriptions"
  | "coinTags"
  | "dashboardState"
  | "fundingRateBySymbol"
  | "marketCapFetchedAtBySymbol"
  | "marketCapUSDBySymbol"
  | "volatilityMap"
  | "volume24hBySymbol"
> &
  Pick<
    LatestVolatilityPointControls,
    "selectedTags" | "sortDirection" | "sortKey" | "symbolSearch"
  >) {
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

  return {
    configuredLabelFrequency,
    configuredSymbols,
    displayableRows,
    missingVolatilitySymbols,
    rows,
  };
}
