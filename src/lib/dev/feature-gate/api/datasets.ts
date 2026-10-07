import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import featureGate from "..";

/**
 * GET /api/dev/feature-gate/datasets — backtest runs that captured a
 * feature-gate dataset (the "also produce dataset" runs), newest first.
 * Feeds the hash picker: `{datasets: [{hash, coins, range, …}]}`.
 */
export default async function featureGateDatasetsHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  res.json({ datasets: await featureGate.dataset.listRuns() });
}
