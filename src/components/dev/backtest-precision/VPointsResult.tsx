"use client";

import VPointsFrequency from "@/components/LiveDashboard/Feature/VPointsFrequency";
import { TradesTableSection } from "@/components/LiveDashboard/Reporting/TradesTableSection";
import type { BacktestPrecisionResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { Box, Grid, Typography } from "@mui/material";

import BacktestResultSummary from "./ResultSummary";
import VolatilityRails from "./VolatilityRails";

export default function VPointsResult({
  accounts,
  result,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  result: BacktestPrecisionResult;
}) {
  const tradeHistory = result.positions
    .filter((position) => position.closed)
    .map((position) => ({ ...position, mode: "sandbox" as const }));

  return (
    <Box sx={{ p: 0.5 }}>
      <VolatilityRails volatilityMap={result.vPointsMap} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Trade History ({tradeHistory.length})
          </Typography>
          <TradesTableSection
            exchangeType={result.exchangeType}
            getVolatilityPoints={(symbol) =>
              result.vPointsMap[symbol.toUpperCase().replace(/_USDT$/, "")] ?? []
            }
            history={tradeHistory}
            mode="sandbox"
            onHistoryChange={() => undefined}
            readOnly
          />
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <BacktestResultSummary
            accounts={accounts}
            positions={result.positions}
            snapshots={result.balanceSnapshots}
          />
          <VPointsFrequency volatilityMap={result.vPointsMap} />
        </Grid>
      </Grid>
    </Box>
  );
}
