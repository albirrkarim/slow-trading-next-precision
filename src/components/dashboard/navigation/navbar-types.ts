"use client";

import type { RuntimeDashboardState } from "@/lib/system/dashboard";

export type {
  BalanceSummary,
  ConfigDraft,
  ConfigDraftSetter,
  DashboardState,
  DayPreviewSummary,
  OpenPositionSummary,
} from "@/components/settings/settings-types";

export interface LiveDashboardNavbarProps {
  dashboardState: RuntimeDashboardState | null;
  onRefresh: () => Promise<void>;
  onReinitialize: () => Promise<void>;
  reinitializing: boolean;
  selectedAccountSlug?: string;
  setSelectedAccountSlug: (slug: string) => void;
}
