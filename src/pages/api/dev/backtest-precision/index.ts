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

  const { default: backtestPrecisionHandler } =
    await import("@/lib/dev/backtestPrecision/api/run");

  await backtestPrecisionHandler(req, res);
}
