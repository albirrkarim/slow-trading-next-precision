"use client";

import VPointsFrequency from "@/components/LiveDashboard/Feature/VPointsFrequency";
import type { BacktestPrecisionResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { Box, Grid } from "@mui/material";

import VolatilityRails from "./VolatilityRails";

export default function VPointsResult({
  result,
}: {
  result: BacktestPrecisionResult;
}) {
  return (
    <Box sx={{ p: 0.5 }}>
      <VolatilityRails volatilityMap={result.vPointsMap} />
      <Grid container spacing={2}>
        <Grid size={{ md: 8 }}>


        </Grid>

        <Grid size={{ md: 4 }}>
          <VPointsFrequency volatilityMap={result.vPointsMap} />
        </Grid>
      </Grid>
    </Box>
  );
}
