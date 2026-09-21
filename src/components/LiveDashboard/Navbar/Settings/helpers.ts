"use client";

import type { TradingConfig } from "@/lib/trading/models";
import postAverageRescue from "@/lib/trading/post-average-rescue";
import postAverageStopLoss from "@/lib/trading/post-average-stop-loss";
import levelBasedPctDriftStopLoss from "@/lib/trading/level-based-pct-drift-stop-loss";
import type { Theme } from "@mui/material";

import { computeDailyPnlPercentStats } from "../../Reporting/utils";
import type {
  BalanceSummary,
  ConfigDraft,
  DashboardState,
  DayPreviewSummary,
  OpenPositionSummary,
} from "./settings-types";
import slowTradingClient from "@/lib/slowTrading/client";
import slowTradingDailyPnlLimit from "@/lib/slowTrading/daily-pnl-limit";

function computeLockedPositionValue(
  position: NonNullable<DashboardState>["openPositions"][number],
): number {
  return slowTradingClient.watchReserve.balance.getLockedPositionMarginUsdt(
    position,
  );
}

export function pickTradingConfigFields(
  tradingConfig: TradingConfig,
): TradingConfig {
  const {
    takeProfitPercent,
    stopLossPercent,
    exitOnVPointAbsLevel,
    stopLossUSDT,
    volatilityTargetStopLossPercent,
    postAverageRescueExit,
    postAverageStopLoss: rawPostAverageStopLoss,
    levelBasedPctDriftStopLoss: rawLevelBasedPctDriftStopLoss,
    maxHoldMinutes,
    orderType,
    useStopLossPlus,
    stopLossPlusTrigger,
    balanceUSDT,
    maxRiskPercent,
    maxBuyUSDT,
    onlyTPFromDate,
    dcaDipPercent,
    maxDcaRounds,
    confidenceBase,
    safeUSDTPerMonth,
    safePercentPerMonth,
    minimalAssetOnTrade,
  } = tradingConfig;

  return {
    takeProfitPercent,
    stopLossPercent,
    exitOnVPointAbsLevel,
    stopLossUSDT,
    volatilityTargetStopLossPercent,
    postAverageRescueExit: postAverageRescue.config.normalize(
      postAverageRescueExit,
    ),
    postAverageStopLoss: postAverageStopLoss.config.normalize(
      rawPostAverageStopLoss,
    ),
    levelBasedPctDriftStopLoss: levelBasedPctDriftStopLoss.config.normalize(
      rawLevelBasedPctDriftStopLoss,
    ),
    maxHoldMinutes,
    orderType,
    useStopLossPlus,
    stopLossPlusTrigger,
    balanceUSDT,
    maxRiskPercent,
    maxBuyUSDT,
    onlyTPFromDate,
    dcaDipPercent,
    maxDcaRounds,
    confidenceBase,
    safeUSDTPerMonth,
    safePercentPerMonth,
    minimalAssetOnTrade,
  };
}

export function makeConfigDraft(state: DashboardState): ConfigDraft {
  const runtime = structuredClone(state.runtime);

  return {
    management: {
      name: state.config.name,
      description: state.config.description,
      symbols: [...state.config.symbols],
      minimalAssetOnTrade: state.config.minimalAssetOnTrade,
      safePercentPerMonth: state.config.safePercentPerMonth,
      safeUSDTPerMonth: state.config.safeUSDTPerMonth,
      exchangeType: state.config.exchangeType,
      tradingMode: state.config.tradingMode,
      decisionEngineVersion: state.config.decisionEngineVersion,
      blackSwan: structuredClone(state.config.blackSwan),
    },
    runtime,
    accounts: state.accounts.map((account) => structuredClone(account)),
  };
}

export function parseSymbols(symbolsText: string): string[] {
  return Array.from(
    new Set(
      symbolsText
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

/**
 * Returns whether automatic entries can currently run.
 */
export function computeAutoEntryActive(
  dashboardState: DashboardState | null,
): boolean {
  const dailyPnlLimit = slowTradingDailyPnlLimit.guard.evaluate({
    positions: dashboardState?.history ?? [],
    thresholdUsdt: dashboardState?.runtime.autoEntryDailyPnlLimitUSDT,
  });

  return Boolean(
    dashboardState?.runtime.runnerEnabled &&
    dashboardState.runtime.autoEntryEnabled &&
    !dailyPnlLimit.reached,
  );
}

export function getPnlPercentBg(theme: Theme, value: number) {
  if (value > 0) return theme.palette.success.main;
  if (value > -40) return theme.palette.info.light;
  if (value < -40) return theme.palette.warning.main;
  return theme.palette.error.main;
}

export function computeOpenPositionSummary(
  dashboardState: DashboardState | null,
): OpenPositionSummary {
  const positions = dashboardState?.openPositions ?? [];
  if (positions.length === 0) {
    return {
      totalPnlUSDT: 0,
      avgPnlPercent: 0,
      lockedCapitalUSDT: 0,
    };
  }

  const totalPnlUSDT = positions.reduce(
    (acc, position) => acc + (Number(position.pnl.netUsdt) || 0),
    0,
  );
  const lockedCapitalUSDT = positions.reduce(
    (acc, position) => acc + computeLockedPositionValue(position),
    0,
  );
  const pnlPercents = positions
    .map((position) =>
      typeof position.pnl.netPct === "number"
        ? position.pnl.netPct
        : Number(position.pnl.netPct),
    )
    .filter((value) => Number.isFinite(value)) as number[];

  return {
    totalPnlUSDT,
    avgPnlPercent:
      pnlPercents.length > 0
        ? pnlPercents.reduce((acc, value) => acc + value, 0) /
          pnlPercents.length
        : 0,
    lockedCapitalUSDT,
  };
}

export function computeDayPreview(
  dashboardState: DashboardState | null,
  now = new Date(),
): DayPreviewSummary {
  const history = dashboardState?.history ?? [];
  const percentStats = computeDailyPnlPercentStats(history);
  const todayKey = now.toISOString().slice(0, 10);
  const todayPercent = percentStats.find((stat) => stat.day === todayKey);

  return {
    dailyUsdtProfit: slowTradingDailyPnlLimit.pnl.sumForUtcDay(
      history,
      todayKey,
    ),
    dailyPnlPercentSum: todayPercent?.pnlPercentSum ?? 0,
  };
}

/** Formats the live browser-tab title from the deployment name and UTC-day PnL. */
export function formatDailyPnlMetaTitle(
  appName: string,
  dailyUsdtProfit: number,
): string {
  const normalizedAppName = appName.trim() || "SLOW";
  const normalizedPnl = Number.isFinite(dailyUsdtProfit) ? dailyUsdtProfit : 0;
  const sign = normalizedPnl >= 0 ? "+" : "-";

  return `${normalizedAppName} | ${sign}$${Math.abs(normalizedPnl).toFixed(2)}`;
}

export function computeBalanceSummary(
  dashboardState: DashboardState | null,
  openPositionSummary: OpenPositionSummary,
): BalanceSummary {
  if (!dashboardState) {
    return {
      available: 0,
      reserved: 0,
      spendable: 0,
      safeHaven: 0,
      startingBalance: 0,
      locked: openPositionSummary.lockedCapitalUSDT,
      total: openPositionSummary.lockedCapitalUSDT,
    };
  }

  return computeBalanceSummaryFromBalances(dashboardState.balances);
}

/** Converts a persisted dashboard balance block into navbar balance metrics. */
export function computeBalanceSummaryFromBalances(
  balances: DashboardState["balances"],
): BalanceSummary {
  const available = balances.availableQuoteAsset;
  const reserved = balances.reservedQuoteAsset;
  const safeHaven = balances.safeHaven;
  const startingBalance = balances.startingBalanceUSDT;
  const locked = balances.lockedQuoteAsset;
  const spendable = balances.spendableQuoteAsset;

  return {
    available,
    reserved,
    spendable,
    safeHaven,
    startingBalance,
    locked,
    total: available + locked,
  };
}
