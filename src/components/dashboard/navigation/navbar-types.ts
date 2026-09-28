"use client";

import type { RuntimeDashboardState } from "@/lib/system/dashboard";



export type { ConfigDraftSetter, ConfigDraft } from "./Settings/settings-types";

export type DashboardState = NonNullable<RuntimeDashboardState>;

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

export interface LiveDashboardNavbarProps {
  dashboardState: RuntimeDashboardState | null;
  onRefresh: () => Promise<void>;
  onReinitialize: () => Promise<void>;
  reinitializing: boolean;
  selectedAccountSlug?: string;
  setSelectedAccountSlug: (slug: string) => void;
}
