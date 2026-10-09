import { readFile } from "node:fs/promises";
import path from "node:path";

import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

/** Serves the same frozen v3 artifact used by engine warmup to browser inference. */
export default async function model(req: NextApiRequest, res: NextApiResponse) {
  if (!systemConfig.devBacktest.isEnabled()) return res.status(404).json({ error: "Not found" });
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  try {
    const file = path.resolve("src/lib/strategies/default_with_features_gate/features/v3/model.json");
    const body = await readFile(file, "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
}
