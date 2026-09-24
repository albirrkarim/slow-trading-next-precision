import { isDevBacktestEnabled } from "@/lib/dev/enabled";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!isDevBacktestEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { default: leaderboardsHandler } =
    await import("@/lib/dev/backtestPrecision/api/leaderboards");

  await leaderboardsHandler(req, res);
}
