import type { Metadata } from "next";

import LivePage from "@/components/live/LivePage";

const appName = String(process.env.APP_NAME ?? "PRECISION").trim() || "PRECISION";

export const metadata: Metadata = {
  title: `${appName} | Live Chart`,
  description: "Live candles with indicators, volatility points, and free scroll-back.",
};

export default function Live() {
  return <LivePage />;
}
