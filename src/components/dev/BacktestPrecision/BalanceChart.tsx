"use client";

import { useMemo } from "react";

import { Typography } from "@mui/material";

import { DEFAULT_COLORS } from "@/components/client/constants";
import type { LeveledMarkers } from "@/components/LiveDashboard/converter";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { BalanceSummary } from "@/lib/system/trading";

const BALANCE_SERIES: Array<{ key: keyof BalanceSummary; name: string }> = [
  { key: "total", name: "Total" },
  { key: "spendable", name: "Spendable" },
  { key: "available", name: "Available" },
  { key: "locked", name: "Locked" },
  { key: "reserved", name: "Reserved" },
  { key: "safeHaven", name: "Safe Haven" },
  { key: "startingBalance", name: "Start" },
];

export default function BacktestBalanceChart(props: {
  snapshots: BacktestBalanceSnapshot[];
}) {
  const { snapshots } = props;
  const series = useMemo<LeveledMarkers[][]>(
    () =>
      BALANCE_SERIES.map(({ key }) =>
        snapshots.map((snapshot) => ({
          level: snapshot[key],
          time: Math.floor(snapshot.t / 1000),
        })),
      ),
    [snapshots],
  );

  if (snapshots.length === 0) {
    return null;
  }

  return (
    <HeaderMetrics
      defaultExpanded
      rememberExpand="backtest-precision:balance"
      title={
        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
          Balance Over Time
        </Typography>
      }
    >
      {() => (
        <MultiLineTimelined
          colors={DEFAULT_COLORS}
          height={300}
          names={BALANCE_SERIES.map((item) => item.name)}
          series={series}
          yTickFormatter={(value) => `$${Number(value).toFixed(0)}`}
        />
      )}
    </HeaderMetrics>
  );
}
