import { spawn } from "child_process";

import { FILES } from "@/components/storage";
import fs from "fs-extra";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";

const TEST_CASE_PATTERN = /^(live|sandbox)-\d+-\d+\.json$/;

/** Spawns the isolated backtest driver process. */
function spawnBacktestRun(params: {
  runId: string;
  datasetFile: string;
  testCasePath: string;
  outputDir: string;
  statusFile: string;
  slippagePct?: number;
}): void {
  const args = [
    "-r",
    "tsconfig-paths/register",
    "src/driver/backtest.ts",
    "run",
    "--dataset",
    params.datasetFile,
    "--test-case",
    params.testCasePath,
    "--output-dir",
    params.outputDir,
    "--status-file",
    params.statusFile,
  ];
  if (params.slippagePct !== undefined) {
    args.push("--slippage-pct", String(params.slippagePct));
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
      const runId = String(req.query.runId ?? "");
      if (!/^[\w-]+$/.test(runId)) {
        res.status(400).json({ error: "runId is required" });
        return;
      }
      const statusFile = FILES.slow.precision.backtestRunStatus(runId);
      if (!(await fs.pathExists(statusFile))) {
        res.status(404).json({ error: "Unknown backtest run" });
        return;
      }
      res.status(200).json(await fs.readJSON(statusFile));
      return;
    }

    if (req.method === "POST") {
      const testCase = String(req.body?.testCase ?? "");
      const dataset = String(req.body?.dataset ?? "");
      if (!TEST_CASE_PATTERN.test(testCase)) {
        res.status(400).json({ error: "testCase is required" });
        return;
      }
      if (!/^[\w.-]+\.json$/.test(dataset)) {
        res.status(400).json({ error: "dataset is required" });
        return;
      }

      const testCasePath = `${FILES.slow.precision.testCaseRoot}/${testCase}`;
      if (!(await fs.pathExists(testCasePath))) {
        res.status(404).json({ error: "Unknown production test case" });
        return;
      }

      const runId = randomUUID().slice(0, 8);
      const statusFile = FILES.slow.precision.backtestRunStatus(runId);
      await fs.ensureDir(FILES.slow.precision.backtestRunStatusRoot);
      await fs.writeJSON(statusFile, {
        status: "starting",
        updatedAt: Date.now(),
      });
      spawnBacktestRun({
        runId,
        datasetFile: dataset,
        testCasePath,
        outputDir: FILES.slow.precision.backtestResultRoot,
        statusFile,
        slippagePct:
          req.body?.slippagePct !== undefined &&
          Number.isFinite(Number(req.body.slippagePct))
            ? Number(req.body.slippagePct)
            : undefined,
      });
      res.status(200).json({ runId, statusFile });
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    res.status(500).json({
      error: error?.message ?? "Failed to manage backtest run",
    });
  }
}
