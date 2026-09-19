"use client";

import type {
  SlowTradingSafeHavenSchedule,
  SlowTradingSettingsConfig,
  SlowTradingWithdrawalSchedule,
  SlowTradingWithdrawalWallet,
} from "@/lib/slowTrading";
import type { Dispatch, SetStateAction } from "react";

export type { DashboardState } from "../navbar-types";

/** The Settings dialog edits the same grouped shape used by persistence/backtests. */
export type ConfigDraft = SlowTradingSettingsConfig;

export type ConfigDraftSetter = Dispatch<SetStateAction<ConfigDraft | null>>;

export type WithdrawalWalletDraft = SlowTradingWithdrawalWallet;
export type WithdrawalScheduleDraft = SlowTradingWithdrawalSchedule;
export type SafeHavenScheduleDraft = SlowTradingSafeHavenSchedule;

export interface OpenPositionSummary {
  totalPnlUSDT: number;
  avgPnlPercent: number;
  lockedCapitalUSDT: number;
}

export interface DayPreviewSummary {
  dailyUsdtProfit: number;
  dailyPnlPercentSum: number;
}

export interface BalanceSummary {
  available: number;
  reserved: number;
  spendable: number;
  safeHaven: number;
  startingBalance: number;
  locked: number;
  total: number;
}
