import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import featureGate from "..";
import { HASH_PATTERN } from "../dataset";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const pickHash = (value: unknown): string | undefined =>
  typeof value === "string" && HASH_PATTERN.test(value.trim())
    ? value.trim()
    : undefined;

/**
 * POST /api/dev/feature-gate/evaluate — `{slug, hash, enabledSubGates?}`; replays the gate
 * version over the run's dataset rows and reports the feature-extraction
 * metrics. The caller decides which run plays train vs test.
 */
export default async function featureGateEvaluateHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const body = isRecord(req.body) ? req.body : {};
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    res.status(400).json({ error: '"slug" is required.' });
    return;
  }
  const hash = pickHash(body.hash);
  if (!hash) {
    res.status(400).json({ error: '"hash" must be a 64-char cache key.' });
    return;
  }

  try {
    res.json(await featureGate.evaluate({ hash, slug, enabledSubGates: body.enabledSubGates }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    // Unknown gate slugs are client errors; a missing dataset dir means the
    // run predates dataset capture.
    res
      .status(message.includes("no dataset") ? 404 : 400)
      .json({ error: message });
  }
}
