"use client";

import { useMemo } from "react";

import { Box, Typography } from "@mui/material";

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

function toSeries(snapshots: BacktestBalanceSnapshot[]): LeveledMarkers[][] {
  return BALANCE_SERIES.map(({ key }) =>
    snapshots.map((snapshot) => ({
      level: snapshot[key],
      time: Math.floor(snapshot.t / 1000),
    })),
  );
}

export default function BacktestBalanceChart(props: {
  accounts?: Array<{ name?: string; slug: string }>;
  snapshots: Record<string, BacktestBalanceSnapshot[]>;
}) {
  const { accounts, snapshots } = props;
  const nameBySlug = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.slug, account.name])),
    [accounts],
  );
  const seriesByAccount = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(snapshots).map(([slug, accountSnapshots]) => [
          slug,
          toSeries(accountSnapshots),
        ]),
      ),
    [snapshots],
  );

  const slugs = Object.keys(seriesByAccount);
  if (slugs.length === 0) {
    return null;
  }

  return (
    <HeaderMetrics
      rememberExpand="backtest-precision:balance"
      title={
        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
          Balance Over Time
        </Typography>
      }
    >
      {() => (
        <>
          {slugs.map((slug) => (
            <Box key={slug} sx={{ mb: 1 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: "bold", mb: 0.5 }}
              >
                {nameBySlug.get(slug)?.trim() || slug}
              </Typography>
              <MultiLineTimelined
                colors={DEFAULT_COLORS}
                height={300}
                names={BALANCE_SERIES.map((item) => item.name)}
                series={seriesByAccount[slug]}
                yTickFormatter={(value) => `$${Number(value).toFixed(0)}`}
              />
            </Box>
          ))}
        </>
      )}
    </HeaderMetrics>
  );
}
