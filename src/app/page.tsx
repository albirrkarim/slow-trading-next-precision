import type { Metadata } from "next";

import LiveDashboard from "@/components/dashboard";

const appName = String(process.env.APP_NAME ?? "PRECISION").trim() || "PRECISION";

export const metadata: Metadata = {
  title: `${appName} | +$0.00`,
  description:
    "PRECISION dashboard for managing seasonal trading configuration, balances, volatility signals, open positions, and live execution state.",
};

export default function Home() {
  return <LiveDashboard appName={appName} />;
}
