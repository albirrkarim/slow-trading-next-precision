"use client";

import { useEffect } from "react";

import VPointsFrequency from "@/components/charts/VPointsFrequency";
import {
  VPOINT_WARMUP_MS,
  type BacktestBlackSwanTimeline,
  type BacktestRunCounts,
  type BacktestRunSummary,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { ExchangeType } from "@/lib/system/types";
import { Box, Grid } from "@mui/material";

import type { ConfigDraft } from "@/components/settings/settings-types";

import BacktestTradeHistory from "./BacktestTradeHistory";
import PriceNormalized from "./PriceNormalized";
import BacktestResultSummary from "./ResultSummary";
import TradesOverTime from "./TradesOverTime";
import type { useBacktestArtifacts } from "./use-backtest-artifacts";
import VolatilityRails from "./VolatilityRails";

type Artifacts = ReturnType<typeof useBacktestArtifacts>;

export default function VPointsResult({
  accounts,
  artifacts,
  blackSwanTimeline,
  counts,
  datasetEndTimeMs,
  datasetStartTimeMs,
  exchangeType,
  settings,
  summary,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  artifacts: Artifacts;
  /** Recorded Black Swan status history for this run; absent on old results. */
  blackSwanTimeline?: BacktestBlackSwanTimeline;
  counts: BacktestRunCounts;
  /** Effective dataset end of this run. */
  datasetEndTimeMs?: number;
  /** Effective dataset start — trading begins once the vPoint warm-up ends. */
  datasetStartTimeMs?: number;
  exchangeType: ExchangeType;
  settings?: ConfigDraft | null;
  summary: BacktestRunSummary;
}) {
  const { positions, vpoints } = artifacts;
  const { ensure: ensureVpoints } = vpoints;

  // vPoints feed the always-rendered frequency card plus the collapsible
  // rails and feature charts, so they load as soon as a result exists.
  // Positions stay lazy — Trade History collapses by default and the Daily
  // PnL Calendar dialog loads them when it opens.
  useEffect(() => {
    void ensureVpoints();
  }, [ensureVpoints]);

  return (
    <Box sx={{ p: 0.5 }}>
      <VolatilityRails
        blackSwanTimeline={blackSwanTimeline}
        datasetEndTimeMs={datasetEndTimeMs}
        datasetStartTimeMs={datasetStartTimeMs}
        tradingStartTimeMs={
          datasetStartTimeMs !== undefined
            ? datasetStartTimeMs + VPOINT_WARMUP_MS
            : undefined
        }
        volatilityMap={vpoints.data ?? {}}
      />
      <PriceNormalized
        datasetEndTimeMs={datasetEndTimeMs}
        datasetStartTimeMs={datasetStartTimeMs}
        features={artifacts.features}
        symbolOrder={Object.keys(vpoints.data ?? {})}
      />
      <TradesOverTime
        datasetEndTimeMs={datasetEndTimeMs}
        datasetStartTimeMs={datasetStartTimeMs}
        positions={positions}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <BacktestTradeHistory
            accounts={accounts}
            closedCount={counts.closedPositions}
            exchangeType={exchangeType}
            positions={positions}
            vpoints={vpoints}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <BacktestResultSummary
            accounts={accounts}
            settings={settings}
            summary={summary}
          />
          <VPointsFrequency volatilityMap={vpoints.data ?? {}} />
        </Grid>
      </Grid>
    </Box>
  );
}
