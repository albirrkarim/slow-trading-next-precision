"use client";

import { memo, useEffect, useMemo } from "react";

import { Alert, Box, CircularProgress, Typography } from "@mui/material";

import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { BalanceSummary } from "@/lib/system/trading";

import type { LazyArtifact } from "./use-backtest-artifacts";

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

/** Chart body — mounted only when the section expands — loads snapshots. */
function SnapshotsChart({
  accounts,
  snapshots,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  snapshots: LazyArtifact<Record<string, BacktestBalanceSnapshot[]>>;
}) {
  const { ensure } = snapshots;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  const nameBySlug = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.slug, account.name])),
    [accounts],
  );
  const seriesByAccount = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(snapshots.data ?? {}).map(([slug, accountSnapshots]) => [
          slug,
          toSeries(accountSnapshots),
        ]),
      ),
    [snapshots.data],
  );

  if (snapshots.error) {
    return <Alert severity="error">{snapshots.error}</Alert>;
  }
  if (!snapshots.data) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const slugs = Object.keys(seriesByAccount);
  if (slugs.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        No balance snapshots were captured.
      </Typography>
    );
  }

  return (
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
  );
}

function BacktestBalanceChartView(props: {
  accounts?: Array<{ name?: string; slug: string }>;
  snapshots: LazyArtifact<Record<string, BacktestBalanceSnapshot[]>>;
}) {
  const { accounts, snapshots } = props;

  return (
    <HeaderMetrics
      rememberExpand="backtest-precision:balance"
      defaultExpanded={false}
      title={
        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
          Balance Over Time
        </Typography>
      }
    >
      {(expanded) => expanded && (
        <SnapshotsChart accounts={accounts} snapshots={snapshots} />
      )}
    </HeaderMetrics>
  );
}

export default memo(BacktestBalanceChartView);
