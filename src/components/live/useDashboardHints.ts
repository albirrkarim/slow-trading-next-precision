"use client";

import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";

/** Engine's built-in move threshold when the dashboard config is unavailable. */
const DEFAULT_MOVE_PCT = 5;

/** Common coins suggested when signed out. */
const FALLBACK_COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "SUI", "HBAR", "XLM", "AVAX", "LINK"];

/** Normalizes typed input (`sol`, `SOLUSDT`, `sol_usdt`) to a base symbol. */
export function normalizeCoin(value: string): string {
  return value.trim().toUpperCase().replace(/_?USDT$/, "");
}

/**
 * What `/live` can learn from the dashboard when signed in: the configured
 * coins (suggestions) and the engine's effective vPoint move threshold.
 * Falls back to common coins and the 5% default otherwise.
 */
export function useDashboardHints(): { coins: string[]; movePct: number } {
  const [hints, setHints] = useState({ coins: FALLBACK_COINS, movePct: DEFAULT_MOVE_PCT });

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get<{
        config?: { symbols?: string[] };
        globalConfig?: { volatilityThresholdPct?: number };
      }>(endpoints.system.state, { signal: controller.signal })
      .then((res) => {
        const symbols = res.data.config?.symbols ?? [];
        const movePct = Number(res.data.globalConfig?.volatilityThresholdPct);
        setHints({
          coins: symbols.length > 0 ? [...new Set(["BTC", ...symbols.map(normalizeCoin)])] : FALLBACK_COINS,
          movePct: Number.isFinite(movePct) && movePct > 0 ? movePct : DEFAULT_MOVE_PCT,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return hints;
}
