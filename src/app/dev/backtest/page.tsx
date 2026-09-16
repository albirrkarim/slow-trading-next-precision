import type { Metadata } from "next";

import BacktestDashboardPage from "@/components/BacktestDashboard";

export const metadata: Metadata = {
  title: "Backtest",
  description:
    "Configure, run, and inspect precision backtests through the shared runtime.",
};

// TC: BTEST:BACKTEST_DASHBOARD_PAGE
export default function BacktestRoute() {
  return <BacktestDashboardPage />;
}
