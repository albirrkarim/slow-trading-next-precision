"use client";

import { useEffect } from "react";

import VPointsFrequency from "@/components/charts/VPointsFrequency";
import {
  VPOINT_WARMUP_MS,
  type BacktestRunCounts,
  type BacktestRunSummary,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { ExchangeType } from "@/lib/system/types";
import { Box, Grid } from "@mui/material";

import type { ConfigDraft } from "@/components/settings/settings-types";

import BacktestTradeHistory from "./BacktestTradeHistory";
import BacktestResultSummary from "./ResultSummary";
import type { useBacktestArtifacts } from "./use-backtest-artifacts";
import VolatilityRails from "./VolatilityRails";

type Artifacts = ReturnType<typeof useBacktestArtifacts>;

export default function VPointsResult({
  accounts,
  artifacts,
  counts,
  datasetStartTimeMs,
  exchangeType,
  settings,
  summary,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  artifacts: Artifacts;
  counts: BacktestRunCounts;
  /** Effective dataset start — trading begins once the vPoint warm-up ends. */
  datasetStartTimeMs?: number;
  exchangeType: ExchangeType;
  settings?: ConfigDraft | null;
  summary: BacktestRunSummary;
}) {
  const { positions, vpoints } = artifacts;
  const { ensure: ensurePositions } = positions;
  const { ensure: ensureVpoints } = vpoints;

  // The trade-history section is always visible — its rows embed per-symbol
  // vPoint charts — so both fields load as soon as a result exists.
  useEffect(() => {
    void ensurePositions();
    void ensureVpoints();
  }, [ensurePositions, ensureVpoints]);

  return (
    <Box sx={{ p: 0.5 }}>
      <VolatilityRails
        tradingStartTimeMs={
          datasetStartTimeMs !== undefined
            ? datasetStartTimeMs + VPOINT_WARMUP_MS
            : undefined
        }
        volatilityMap={vpoints.data ?? {}}
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
