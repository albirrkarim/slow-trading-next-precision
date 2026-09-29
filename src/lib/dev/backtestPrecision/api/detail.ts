import type { NextApiRequest, NextApiResponse } from "next";

import systemConfig from "@/lib/system/config";

import backtestLeaderboards from "../leaderboards";
import backtestResultCache from "./cache";

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const FIELDS = new Set(["positions", "vpoints", "snapshots", "metrics"]);

const pickQuery = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const pickInt = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * GET /api/dev/backtest-precision/detail — serves one artifact field from a
 * run's chunked cache directory so the dashboard loads heavy arrays only
 * when a section expands.
 *
 * `field=positions` returns `{positions, total, offset, limit}` honoring
 * `offset`/`limit` (defaults to the whole list). `field=vpoints` returns
 * `{vPointsMap}` or `{symbol, vPoints}` when `symbol` is given;
 * `field=snapshots` returns `{balanceSnapshots}` or `{slug, snapshots}`.
 */
export default async function backtestDetailHandler(
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

  const key = pickQuery(req.query.key);
  const field = pickQuery(req.query.field);
  const name = pickQuery(req.query.name);
  if (!key || !KEY_PATTERN.test(key)) {
    res.status(400).json({ error: '"key" must be a 64-char cache key hash.' });
    return;
  }
  if (!field || !FIELDS.has(field)) {
    res
      .status(400)
      .json({ error: '"field" must be positions|vpoints|snapshots|metrics.' });
    return;
  }

  if (field === "metrics") {
    const result = await backtestResultCache.read(key);
    if (!result) {
      res.status(404).json({ error: "Artifact not found for this cache key." });
      return;
    }
    res.json({ metrics: backtestLeaderboards.metrics.compute(result) });
    return;
  }

  const data = await backtestResultCache.readField(
    key,
    field as "positions" | "vpoints" | "snapshots",
    name,
  );
  if (data === null || data === undefined) {
    res.status(404).json({ error: "Artifact not found for this cache key." });
    return;
  }

  if (field === "positions") {
    const positions = data as unknown[];
    const offset = pickInt(pickQuery(req.query.offset)) ?? 0;
    const limit = pickInt(pickQuery(req.query.limit));
    res.json({
      limit: limit ?? Math.max(0, positions.length - offset),
      offset,
      positions:
        limit === undefined
          ? positions.slice(offset)
          : positions.slice(offset, offset + limit),
      total: positions.length,
    });
    return;
  }

  if (field === "vpoints") {
    if (name) {
      res.json({ symbol: name, vPoints: data });
      return;
    }
    res.json({ vPointsMap: data });
    return;
  }

  if (name) {
    res.json({ slug: name, snapshots: data });
    return;
  }
  res.json({ balanceSnapshots: data });
}
