import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import featureGate from "..";

/**
 * GET /api/dev/feature-gate/list — the registered gate versions the
 * evaluation UI offers (`{gates: [{slug, label}]}`).
 */
export default async function featureGateListHandler(
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
  res.json({ gates: featureGate.list() });
}
