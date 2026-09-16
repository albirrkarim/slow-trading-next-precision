import { spawn } from "child_process";

import type { NextApiRequest, NextApiResponse } from "next";
import slowTradingBacktestDataset from "@/lib/backtest/dataset";

/** Spawns the dataset download driver process. */
function spawnDatasetBuild(params: {
  symbols: string[];
  startTime: number;
  endTime: number;
  warmupDays?: number;
}): void {
  const args = [
    "-r",
    "tsconfig-paths/register",
    "src/driver/backtest.ts",
    "build-dataset",
    "--symbols",
    params.symbols.join(","),
    "--start",
    String(params.startTime),
    "--end",
    String(params.endTime),
  ];
  if (params.warmupDays !== undefined) {
    args.push("--warmup-days", String(params.warmupDays));
  }

  const child = spawn("npx", ["tsx", ...args], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") {
      res.status(200).json(await slowTradingBacktestDataset.list());
      return;
    }

    if (req.method === "POST") {
      const symbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols.map((symbol: unknown) =>
            String(symbol || "")
              .trim()
              .toUpperCase(),
          )
        : String(req.body?.symbols ?? "")
            .split(",")
            .map((symbol) => symbol.trim().toUpperCase());
      const startTime = Number(req.body?.startTime);
      const endTime = Number(req.body?.endTime);
      const cleanSymbols = symbols.filter(Boolean);
      if (
        cleanSymbols.length === 0 ||
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        startTime >= endTime
      ) {
        res
          .status(400)
          .json({ error: "symbols, startTime, and endTime are required" });
        return;
      }

      spawnDatasetBuild({
        symbols: cleanSymbols,
        startTime,
        endTime,
        warmupDays: Number.isFinite(Number(req.body?.warmupDays))
          ? Number(req.body.warmupDays)
          : undefined,
      });
      res.status(202).json({
        status: "building",
        message:
          "Dataset download started; refresh the list to see it when finished.",
      });
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message ?? "Failed to manage backtest datasets" });
  }
}
