"use client";

import { Box, MenuItem, Select, Typography } from "@mui/material";
import { useState, useSyncExternalStore } from "react";

import DarkToggle from "@/components/ui/DarkToggle";
import SidebarButton from "@/components/ui/SidebarButton";
import type { IntervalKlines } from "@/lib/exchange";

import type { LiveMarket } from "./binanceLiveSocket";
import CoinPicker from "./CoinPicker";
import LiveChart from "./LiveChart";
import { useDashboardHints } from "./useDashboardHints";
import { LIVE_INTERVALS } from "./useLiveKlines";

const STORAGE_KEY = "precision:live-chart:v1";
const SELECT_SX = { fontSize: "0.875rem", height: 34, minWidth: 96 } as const;

interface LiveSelection {
  symbol: string;
  interval: IntervalKlines;
  market: LiveMarket;
}

const DEFAULT_SELECTION: LiveSelection = { interval: "15m", market: "FUTURES", symbol: "BTC" };

/** Last coin/interval/market, falling back to defaults on missing or bad storage. */
function readSelection(): LiveSelection {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      interval: LIVE_INTERVALS.includes(raw?.i) ? raw.i : DEFAULT_SELECTION.interval,
      market: raw?.m === "SPOT" ? "SPOT" : "FUTURES",
      symbol: typeof raw?.s === "string" && raw.s ? raw.s : DEFAULT_SELECTION.symbol,
    };
  } catch {
    return DEFAULT_SELECTION;
  }
}

/** False during SSR and hydration, true after — storage is client-only. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

/** `/live` — TradingView-style live chart for any coin. */
export default function LivePage() {
  const mounted = useMounted();
  const [chosen, setChosen] = useState<LiveSelection | null>(null);
  const selection = chosen ?? (mounted ? readSelection() : null);
  const hints = useDashboardHints();

  const update = (patch: Partial<LiveSelection>) =>
    setChosen((current) => {
      const next = { ...(current ?? readSelection()), ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ i: next.interval, m: next.market, s: next.symbol }));
      } catch {
        // Storage unavailable — the selection simply won't persist.
      }
      return next;
    });

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ alignItems: "center", display: "flex", gap: 1, mb: 1 }}>
        <SidebarButton />
        <Typography fontWeight={700} sx={{ flex: 1 }} variant="h6">
          Live Chart
        </Typography>
        <DarkToggle />
      </Box>
      {selection && (
        <LiveChart
          controls={
            <>
              <CoinPicker onChange={(symbol) => update({ symbol })} options={hints.coins} value={selection.symbol} />
              <Select
                onChange={(event) => update({ market: event.target.value as LiveMarket })}
                size="small"
                sx={SELECT_SX}
                title="Market"
                value={selection.market}
              >
                <MenuItem value="FUTURES">Futures</MenuItem>
                <MenuItem value="SPOT">Spot</MenuItem>
              </Select>
              <Select
                onChange={(event) => update({ interval: event.target.value as IntervalKlines })}
                size="small"
                sx={SELECT_SX}
                title="Interval"
                value={selection.interval}
              >
                {LIVE_INTERVALS.map((interval) => (
                  <MenuItem key={interval} value={interval}>
                    {interval}
                  </MenuItem>
                ))}
              </Select>
            </>
          }
          engineMovePct={hints.movePct}
          interval={selection.interval}
          key={`${selection.symbol}:${selection.interval}:${selection.market}`}
          market={selection.market}
          symbol={selection.symbol}
        />
      )}
    </Box>
  );
}
