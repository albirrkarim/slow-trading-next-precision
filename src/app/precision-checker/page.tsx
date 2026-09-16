import type { Metadata } from "next";

import PrecisionCheckerPage from "@/components/PrecisionChecker";

export const metadata: Metadata = {
  title: "Precision Checker",
  description:
    "Compare final production and backtest positions for equivalent runs.",
};

// TC: BTEST:PRECISION_CHECKER_PAGE
export default function PrecisionCheckerRoute() {
  return <PrecisionCheckerPage />;
}
