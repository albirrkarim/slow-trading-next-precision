import type { NextApiRequest, NextApiResponse } from "next";
import systemConfig from "@/lib/system/config";
import backtestLeaderboards from "@/lib/dev/backtestPrecision/leaderboards";
import { PROFILE_METRICS } from "@/lib/dev/backtestPrecision/leaderboards/leaves";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Leaderboard profile CRUD — named weighted-metric views used to score and
 * sort saved entries. Persisted at storage/leaderboards/profiles.json.
 */
export default async function backtestLeaderboardProfilesHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    res.json({
      metrics: PROFILE_METRICS,
      profiles: await backtestLeaderboards.profiles.list(),
    });
    return;
  }

  if (req.method === "POST") {
    const body = isRecord(req.body) ? req.body : {};
    const result = await backtestLeaderboards.profiles.save({
      name: body.name,
      weights: isRecord(body.weights) ? body.weights : {},
    });
    if (!result.profile) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ profile: result.profile });
    return;
  }

  if (req.method === "DELETE") {
    const body = isRecord(req.body) ? req.body : req.query;
    const name = typeof body.name === "string" ? body.name : "";
    if (name.trim() === "") {
      res.status(400).json({ error: '"name" is required.' });
      return;
    }
    if (!(await backtestLeaderboards.profiles.remove(name))) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ ok: true });
    return;
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
