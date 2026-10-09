import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import featureGate from "..";
import { HASH_PATTERN } from "../dataset";

/** Delivers the captured run once so filtering, inference and metrics can run in the browser. */
export default async function download(req: NextApiRequest, res: NextApiResponse) {
  if (!systemConfig.devBacktest.isEnabled()) return res.status(404).json({ error: "Not found" });
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const hash = typeof req.query.hash === "string" ? req.query.hash.trim() : "";
  if (!HASH_PATTERN.test(hash)) return res.status(400).json({ error: '"hash" must be a 64-char cache key.' });
  try {
    const bySymbol = await featureGate.dataset.readRows(hash);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ rows: Object.values(bySymbol).flat() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes("no dataset") ? 404 : 400).json({ error: message });
  }
}
