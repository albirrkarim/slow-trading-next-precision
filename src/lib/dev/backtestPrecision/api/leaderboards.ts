import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import systemConfig from "@/lib/system/config";
import backtestResultCache from "./cache";
import backtestLeaderboards from "../leaderboards";
import type { BacktestPrecisionResult } from "../backtest/backtest-precision-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the run's result for a save request: reloads the persisted result
 * cache when `cachePath` is provided, else accepts an inline result payload.
 */
async function resolveResult(
  body: Record<string, unknown>,
): Promise<{ cacheKey?: string; result: BacktestPrecisionResult | null }> {
  const cachePath =
    typeof body.cachePath === "string" ? body.cachePath : undefined;
  if (cachePath) {
    const cacheKey = path.basename(cachePath);
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      return { result: null };
    }
    return { cacheKey, result: await backtestResultCache.read(cacheKey) };
  }

  const result = body.result;
  if (
    isRecord(result) &&
    Array.isArray(result.positions) &&
    isRecord(result.balanceSnapshots)
  ) {
    return { result: result as unknown as BacktestPrecisionResult };
  }
  return { result: null };
}

export default async function backtestLeaderboardsHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    res.json({ entries: await backtestLeaderboards.store.list() });
    return;
  }

  if (req.method === "POST") {
    const body = isRecord(req.body) ? req.body : {};
    if (!isRecord(body.backtestConfig)) {
      res.status(400).json({ error: '"backtestConfig" must be an object.' });
      return;
    }

    const { cacheKey, result } = await resolveResult(body);
    if (!result) {
      res.status(409).json({
        error:
          "Backtest result is not cached; run the backtest again before saving.",
      });
      return;
    }

    const entry = await backtestLeaderboards.store.save({
      backtestConfig: body.backtestConfig,
      cacheKey,
      label: typeof body.label === "string" ? body.label : undefined,
      leaderboard: backtestLeaderboards.metrics.compute(result),
    });
    res.json({ entry });
    return;
  }

  if (req.method === "DELETE") {
    const body = isRecord(req.body) ? req.body : req.query;
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f]{12}$/.test(id)) {
      res.status(400).json({ error: '"id" must be a 12-char entry hash.' });
      return;
    }
    const removed = await backtestLeaderboards.store.remove(id);
    if (!removed) {
      res.status(404).json({ error: "Leaderboard entry not found." });
      return;
    }
    res.json({ ok: true });
    return;
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
