"use client";

import { useEffect } from "react";

import VPointsFrequency from "@/components/charts/VPointsFrequency";
import { TradesTableSection } from "@/components/reports/TradesTableSection";
import type {
  BacktestRunCounts,
  BacktestRunSummary,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { ExchangeType } from "@/lib/system/types";
import { Alert, Box, CircularProgress, Grid, Typography } from "@mui/material";

import type { ConfigDraft } from "@/components/settings/settings-types";

import BacktestResultSummary from "./ResultSummary";
import type { useBacktestArtifacts } from "./use-backtest-artifacts";
import VolatilityRails from "./VolatilityRails";

type Artifacts = ReturnType<typeof useBacktestArtifacts>;

export default function VPointsResult({
  accounts,
  artifacts,
  counts,
  exchangeType,
  settings,
  summary,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  artifacts: Artifacts;
  counts: BacktestRunCounts;
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

  const tradeHistory = (positions.data ?? [])
    .filter((position) => position.closed)
    .map((position) => ({ ...position, mode: "sandbox" as const }));

  return (
    <Box sx={{ p: 0.5 }}>
      <VolatilityRails volatilityMap={vpoints.data ?? {}} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Trade History (
            {positions.data ? tradeHistory.length : counts.closedPositions})
          </Typography>
          {positions.error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {positions.error}
            </Alert>
          )}
          {!positions.data && !positions.error && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {positions.data && (
            <TradesTableSection
              exchangeType={exchangeType}
              getVolatilityPoints={(symbol) =>
                vpoints.data?.[symbol.toUpperCase().replace(/_USDT$/, "")] ??
                []
              }
              history={tradeHistory}
              mode="sandbox"
              onHistoryChange={() => undefined}
              readOnly
            />
          )}
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
