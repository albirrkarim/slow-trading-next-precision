"use client";

import { useEffect, useMemo } from "react";

import { TradesTableSection } from "@/components/reports/TradesTableSection";
import { TradeHistoryFilters } from "@/components/reports/TradesTableSection/TradeHistoryFilters";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";
import {
  Alert,
  Box,
  CircularProgress,
  Typography,
} from "@mui/material";

import type { LazyArtifact } from "./use-backtest-artifacts";

export default function BacktestTradeHistory({
  accounts,
  closedCount,
  exchangeType,
  positions,
  vpoints,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  /** Fallback count shown in the header while positions are still loading. */
  closedCount: number;
  exchangeType: ExchangeType;
  positions: LazyArtifact<Position[]>;
  vpoints: LazyArtifact<Record<string, VolatilityPoint[]>>;
}) {
  const tradeHistory = useMemo(
    () =>
      (positions.data ?? [])
        .filter((position) => position.closed)
        .map((position) => ({ ...position, mode: "sandbox" as const })),
    [positions.data],
  );

  return (
    <HeaderMetrics
      defaultExpanded={false}
      headerCanBeClicked
      rememberExpand="precision-backtest-trade-history"
      title={
        <Typography fontWeight={700} variant="body1">
          Trade History (
          {positions.data ? tradeHistory.length : closedCount})
        </Typography>
      }
    >
      {(expanded) =>
        expanded && (
          <TradeHistoryBody
            accounts={accounts}
            exchangeType={exchangeType}
            positions={positions}
            tradeHistory={tradeHistory}
            vpoints={vpoints}
          />
        )
      }
    </HeaderMetrics>
  );
}

/** Body — mounts only while expanded, so the positions artifact stays lazy. */
function TradeHistoryBody({
  accounts,
  exchangeType,
  positions,
  tradeHistory,
  vpoints,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  exchangeType: ExchangeType;
  positions: LazyArtifact<Position[]>;
  tradeHistory: Array<Position & { mode: "sandbox" }>;
  vpoints: LazyArtifact<Record<string, VolatilityPoint[]>>;
}) {
  const { ensure } = positions;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  const tableAccounts = useMemo(
    () =>
      (accounts ?? []).map((account) => ({
        name: account.name?.trim() || account.slug,
        slug: account.slug,
      })),
    [accounts],
  );

  return (
    <Box>
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
        <TradeHistoryFilters
          accounts={tableAccounts}
          history={tradeHistory}
          storageKey="precision-backtest-trade-history-filters"
        >
          {(filteredTradeHistory) => (
            <TradesTableSection
              accounts={tableAccounts}
              exchangeType={exchangeType}
              getVolatilityPoints={(symbol) =>
                vpoints.data?.[symbol.toUpperCase().replace(/_USDT$/, "")] ??
                []
              }
              history={filteredTradeHistory}
              mode="sandbox"
              onHistoryChange={() => undefined}
              readOnly
            />
          )}
        </TradeHistoryFilters>
      )}
    </Box>
  );
}
