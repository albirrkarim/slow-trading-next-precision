/**
 * Precision backtest driver.
 *
 * Usage:
 *   npx tsx src/driver/backtest.ts build-dataset --symbols SUI,BTC --start <ms> --end <ms> [--warmup-days 30]
 *   npx tsx src/driver/backtest.ts run --dataset <file.json> --test-case <abs path> --output-dir <abs dir> [--status-file <abs path>]
 *
 * The run command executes in an isolated PERSISTENT_STORAGE_ROOT so the
 * backtest can never read or write production live/sandbox storage.
 */
import fs from "fs-extra";
import os from "os";
import path from "path";
import type { ProdTestCaseV1 } from "@/lib/precision/types";

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = ""] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { command, flags };
}

function requireFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string {
  const value = flags[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing required --${name} flag`);
  }

  return value;
}

async function writeStatus(
  statusFile: string | undefined,
  status: Record<string, unknown>,
): Promise<void> {
  if (!statusFile) {
    return;
  }
  await fs.ensureDir(path.dirname(statusFile));
  await fs.writeJSON(statusFile, { ...status, updatedAt: Date.now() });
}

async function buildDataset(flags: Record<string, string | boolean>) {
  const symbols = requireFlag(flags, "symbols")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  const startTime = Number(requireFlag(flags, "start"));
  const endTime = Number(requireFlag(flags, "end"));
  const warmupDays = Number(flags["warmup-days"] ?? 30);

  const { default: slowTradingBacktestDataset } = await import(
    "@/lib/backtest/dataset"
  );
  const dataset = await slowTradingBacktestDataset.build({
    symbols,
    startTime,
    endTime,
    warmupMs: warmupDays * 24 * 60 * 60_000,
    onProgress: (message) => console.log(message),
  });
  const fileName = await slowTradingBacktestDataset.write(dataset);
  console.log(`Dataset written: ${fileName}`);
}

async function runBacktest(flags: Record<string, string | boolean>) {
  const datasetFile = requireFlag(flags, "dataset");
  const testCaseFile = requireFlag(flags, "test-case");
  const outputDir = path.resolve(requireFlag(flags, "output-dir"));
  const statusFile = flags["status-file"]
    ? path.resolve(String(flags["status-file"]))
    : undefined;
  const slippagePct =
    typeof flags["slippage-pct"] === "string"
      ? Number(flags["slippage-pct"])
      : undefined;

  // A backtest must never send notifications, even when the spawning process
  // injected real credentials into the environment.
  for (const key of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "N8N_EMAIL_PROXY_URL",
    "N8N_EMAIL_PROXY_TOKEN",
    "EMAIL_TO",
  ]) {
    delete process.env[key];
  }

  // Isolate every storage path before any runtime module is imported.
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "slow-precision-backtest-"),
  );
  process.env.PERSISTENT_STORAGE_ROOT = storageRoot;

  const { default: slowTradingBacktestDataset } = await import(
    "@/lib/backtest/dataset"
  );
  const { default: slowTradingBacktestRunner } = await import(
    "@/lib/backtest/runner"
  );

  try {
    await writeStatus(statusFile, { status: "running" });
    const dataset = await slowTradingBacktestDataset.read(datasetFile);
    const testCase = (await fs.readJSON(
      path.resolve(testCaseFile),
    )) as ProdTestCaseV1;

    const { fileName, result } = await slowTradingBacktestRunner.run({
      dataset,
      testCase,
      outputDir,
      storageRoot,
      slippagePct,
      onProgress: (progress) => {
        void writeStatus(statusFile, {
          status: "running",
          ...progress,
        });
      },
    });
    await writeStatus(statusFile, {
      status: "done",
      fileName,
      positionCount: result.endPositions.length,
      metrics: result.metrics,
    });
    console.log(`Backtest result written: ${fileName}`);
  } catch (error: any) {
    await writeStatus(statusFile, {
      status: "error",
      error: error?.message ?? String(error),
    });
    throw error;
  } finally {
    await fs.remove(storageRoot).catch(() => undefined);
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "build-dataset") {
    await buildDataset(flags);
    return;
  }
  if (command === "run") {
    await runBacktest(flags);
    return;
  }

  throw new Error(
    "Unknown command. Use build-dataset or run (see src/driver/backtest.ts header).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
