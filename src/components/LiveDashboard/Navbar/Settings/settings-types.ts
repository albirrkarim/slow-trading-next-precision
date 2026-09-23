"use client";


import type { Dispatch, SetStateAction } from "react";
import type { RuntimeSafeHavenSchedule, RuntimeSettingsConfig, RuntimeWithdrawalSchedule, RuntimeWithdrawalWallet } from "@/lib/system/runtime";

export type { DashboardState } from "../navbar-types";

/** The Settings dialog edits the same grouped shape used by persistence/backtests. */
export type ConfigDraft = RuntimeSettingsConfig;

export type ConfigDraftSetter = Dispatch<SetStateAction<ConfigDraft | null>>;

export type WithdrawalWalletDraft = RuntimeWithdrawalWallet;
export type WithdrawalScheduleDraft = RuntimeWithdrawalSchedule;
export type SafeHavenScheduleDraft = RuntimeSafeHavenSchedule;

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
