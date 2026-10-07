import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import featureGate from "..";
import { HASH_PATTERN } from "../dataset";
import datasetFilters from "../filters";
import type { FeatureGateRowQuery } from "../types";

const pickQuery = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const pickInt = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Parses an optional finite capture-time bound without accepting empty strings. */
function pickTime(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`"${field}" must be a finite timestamp.`);
  return parsed;
}

/** Validates compact references from an evaluation, keeping feature snapshots off request bodies. */
function pickReferences(body: unknown): FeatureGateRowQuery["references"] {
  const value = body as { references?: unknown } | undefined;
  if (!Array.isArray(value?.references)) throw new Error('"references" must be an array of dataset row references.');
  return value.references.map((item: unknown) => {
    const row = item as { symbol?: unknown; t?: unknown; signalId?: unknown } | null;
    if (!row || typeof row.symbol !== "string" || typeof row.signalId !== "string" ||
      typeof row.t !== "number" || !Number.isFinite(row.t)) {
      throw new Error('Each reference requires "symbol", finite "t", and "signalId".');
    }
    return { symbol: row.symbol, t: row.t, signalId: row.signalId };
  });
}

/**
 * GET /api/dev/feature-gate/dataset-rows — paginated view of one run's
 * captured dataset: `hash`, `symbol?`, `page` (default 1), `pageSize`
 * (default 50), `minMissScore`, inclusive capture bounds
 * `fromT`/`toT`, and optional `metric`/`operator`/`value`. Returns
 * `{page, pageSize, rows, symbols, total}`.
 * POST accepts the same query parameters plus `{references}` in the body
 * to inspect only rows counted by a completed evaluation.
 */
export default async function featureGateDatasetRowsHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const hash = pickQuery(req.query.hash)?.trim();
  if (!hash || !HASH_PATTERN.test(hash)) {
    res.status(400).json({ error: '"hash" must be a 64-char cache key hash.' });
    return;
  }

  try {
    res.json(
      await featureGate.dataset.queryRows({
        ...datasetFilters.parseCondition(pickQuery(req.query.metric), pickQuery(req.query.operator), pickQuery(req.query.value)),
        hash,
        references: req.method === "POST" ? pickReferences(req.body) : undefined,
        fromT: pickTime(pickQuery(req.query.fromT), "fromT"),
        toT: pickTime(pickQuery(req.query.toT), "toT"),
        minMissScore: pickInt(pickQuery(req.query.minMissScore)),
        page: pickInt(pickQuery(req.query.page)),
        pageSize: pickInt(pickQuery(req.query.pageSize)),
        order:
          pickQuery(req.query.order) === "desc" ? "desc" : undefined,
        sort: ["missScore", "sequence", "time"].includes(
          pickQuery(req.query.sort) ?? "",
        )
          ? (pickQuery(req.query.sort) as
              | "missScore"
              | "sequence"
              | "time")
          : undefined,
        symbol: pickQuery(req.query.symbol)?.trim() || undefined,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    res
      .status(message.includes("no dataset") ? 404 : 400)
      .json({ error: message });
  }
}
