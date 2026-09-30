"use client";

import { type Dispatch, type SetStateAction, useState } from "react";

import axios from "axios";
import { useSnackbar } from "notistack";

import { endpoints } from "@/components/endpoints";
import { systemLog } from "@/lib/system/logging";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { VolatilityPoint } from "@/lib/system/types";

import type { DashboardConfig } from "./types";

export default function useDashboardActions({
  applyDashboardState,
  config,
  currentExchangeType,
  dashboardState,
  execute,
  selectedAccountSlug,
  setVolatilityMap,
  symbols,
}: {
  applyDashboardState: (nextState: RuntimeDashboardState) => string[];
  config: DashboardConfig;
  currentExchangeType: RuntimeDashboardState["config"]["exchangeType"];
  dashboardState: RuntimeDashboardState | null;
  execute: (reinitialize?: boolean) => Promise<void>;
  selectedAccountSlug: string | undefined;
  setVolatilityMap: Dispatch<
    SetStateAction<Record<string, VolatilityPoint[]> | null>
  >;
  symbols: string[];
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [exitingSymbol, setExitingSymbol] = useState<string | null>(null);
  const [enteringSymbol, setEnteringSymbol] = useState<string | null>(null);
  const [deletingSymbol, setDeletingSymbol] = useState<string | null>(null);
  const [resettingVPointUsed, setResettingVPointUsed] = useState(false);

  const resetAllVPointUsed = async () => {
    if (symbols.length === 0 || !dashboardState) {
      enqueueSnackbar("No volatility points are loaded yet", {
        variant: "warning",
      });
      return;
    }

    if (!confirm("Reset used volatility points for all visible coins?")) {
      return;
    }

    setResettingVPointUsed(true);
    try {
      await axios.post(endpoints.market.volatility, {
        symbols,
        range: config.range,
        startTime: config.startTime,
        endTime: config.endTime,
        exchangeType: currentExchangeType,
        removeUsed: true,
      });
      enqueueSnackbar("Reset used volatility points for all visible coins", {
        variant: "success",
      });
      await execute();
    } catch (error: any) {
      systemLog.error(error);
      enqueueSnackbar(
        `Failed to reset volatility points: ${error.response?.data?.error || error.message}`,
        { variant: "error" },
      );
    } finally {
      setResettingVPointUsed(false);
    }
  };

  const manualExit = async (
    position: RuntimeDashboardState["openPositions"][number],
  ) => {
    const { symbol } = position;
    if (!confirm(`Exit ${symbol} manually now?`)) {
      return;
    }

    // Hedge-mode pair legs share account+symbol — direction targets one leg.
    const direction = position.direction;
    setExitingSymbol(`${position.account}:${symbol}:${direction}`);
    try {
      await axios.post(endpoints.system.manual.exit, {
        account: position.account,
        direction,
        symbol,
      });
      enqueueSnackbar(`Successfully exited ${symbol}`, { variant: "success" });
      await execute();
    } catch (error: any) {
      systemLog.error(error);
      enqueueSnackbar(
        `Manual exit failed for ${symbol}: ${error.response?.data?.error || error.message}`,
        { variant: "error" },
      );
    } finally {
      setExitingSymbol(null);
    }
  };

  const manualEntry = async (symbol: string) => {
    setEnteringSymbol(symbol);
    try {
      const response = await axios.post<{
        success: boolean;
        executed?: boolean;
        message?: string;
      }>(endpoints.system.manual.entry, {
        account: selectedAccountSlug,
        symbol,
      });

      if (response.data.executed) {
        enqueueSnackbar(
          response.data.message || `Successfully entered ${symbol}`,
          { variant: "success" },
        );
      } else {
        enqueueSnackbar(
          response.data.message ||
          `Manual entry did not open a position for ${symbol}`,
          { variant: "warning" },
        );
      }

      await execute();
    } catch (error: any) {
      systemLog.error(error);
      enqueueSnackbar(
        `Manual entry failed for ${symbol}: ${error.response?.data?.error || error.message}`,
        { variant: "error" },
      );
    } finally {
      setEnteringSymbol(null);
    }
  };

  const deleteCoin = async (symbol: string) => {
    if (!dashboardState) return;

    const nextSymbols = dashboardState.config.symbols.filter(
      (configuredSymbol) => configuredSymbol.trim().toUpperCase() !== symbol,
    );
    if (nextSymbols.length === 0) {
      enqueueSnackbar("The trading config must contain at least one coin", {
        variant: "warning",
      });
      return;
    }
    if (!confirm(`Remove ${symbol} from the trading config?`)) return;

    setDeletingSymbol(symbol);
    try {
      const response = await axios.put<RuntimeDashboardState>(
        endpoints.system.state,
        { symbols: nextSymbols },
      );
      applyDashboardState(response.data);
      setVolatilityMap((current) => {
        if (!current) return current;
        const next = { ...current };
        delete next[symbol];
        return next;
      });
      enqueueSnackbar(`${symbol} removed from the trading config`, {
        variant: "success",
      });
      await execute();
    } catch (error: any) {
      systemLog.error(error);
      enqueueSnackbar(
        `Failed to remove ${symbol}: ${error.response?.data?.error || error.message}`,
        { variant: "error" },
      );
    } finally {
      setDeletingSymbol(null);
    }
  };

  return {
    deleteCoin,
    deletingSymbol,
    enteringSymbol,
    exitingSymbol,
    manualEntry,
    manualExit,
    resetAllVPointUsed,
    resettingVPointUsed,
  };
}
