import fs from "fs-extra";
import path from "path";

import { precisionBacktest } from "@/lib/dev/backtestPrecision/backtest";
import { resolvePersistentStorageRoot } from "@/lib/persistent-storage-root";
import type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
} from "@/lib/production/precision-test-case";

import type {
  PrecisionCheckerAccount,
  PrecisionCheckerRunResult,
  PrecisionCheckerTestCaseSummary,
} from "./types";

function testCaseDirectory(): string {
  return path.join(
    resolvePersistentStorageRoot(),
    "dev",
    "precision-test-case",
  );
}

function modeFromFileName(fileName: string): PrecisionTestCaseMode {
  return fileName.startsWith("live-") ? "live" : "sandbox";
}

function isCompletedFileName(fileName: string): boolean {
  return (
    /^(live|sandbox)-.+\.json$/.test(fileName) &&
    !fileName.endsWith("-undefined.json")
  );
}

async function readTestCase(
  filePath: string,
): Promise<PrecisionTestCase | null> {
  try {
    const value = await fs.readJSON(filePath);
    return value && typeof value === "object"
      ? (value as PrecisionTestCase)
      : null;
  } catch {
    return null;
  }
}

function summarize(
  fileName: string,
  testCase: PrecisionTestCase,
): PrecisionCheckerTestCaseSummary | null {
  if (
    !testCase.config ||
    !Number.isFinite(testCase.startTime) ||
    !Number.isFinite(testCase.endTime) ||
    !Array.isArray(testCase.tradeHistory)
  ) {
    return null;
  }

  return {
    fileName,
    mode: modeFromFileName(fileName),
    startTime: testCase.startTime as number,
    endTime: testCase.endTime as number,
    tradeCount: testCase.tradeHistory.length,
  };
}

async function list(): Promise<PrecisionCheckerTestCaseSummary[]> {
  const directory = testCaseDirectory();
  if (!(await fs.pathExists(directory))) {
    return [];
  }

  const summaries: PrecisionCheckerTestCaseSummary[] = [];
  for (const fileName of await fs.readdir(directory)) {
    if (!isCompletedFileName(fileName)) {
      continue;
    }
    const testCase = await readTestCase(path.join(directory, fileName));
    const summary = testCase && summarize(fileName, testCase);
    if (summary) {
      summaries.push(summary);
    }
  }

  return summaries.sort((a, b) => b.endTime - a.endTime);
}

async function run(fileName: string): Promise<PrecisionCheckerRunResult> {
  if (
    typeof fileName !== "string" ||
    path.basename(fileName) !== fileName ||
    !isCompletedFileName(fileName)
  ) {
    throw new Error(
      `Invalid precision test case file name: ${String(fileName)}`,
    );
  }

  const filePath = path.join(testCaseDirectory(), fileName);
  const testCase = await readTestCase(filePath);
  const testCaseSummary = testCase && summarize(fileName, testCase);
  if (!testCase || !testCaseSummary) {
    throw new Error(`Precision test case not found: ${fileName}`);
  }

  const result = await precisionBacktest({
    config: testCase.config,
    startTime: testCase.startTime as number,
    endTime: testCase.endTime as number,
    range: "custom",
    initialVPointsMap: testCase.initialVPointsMap,
    mode: "precision-checker",
    upToDateDecisionBacktest: false,
    upToDateKlines: false,
    verbose: false,
  });

  const accounts: PrecisionCheckerAccount[] = (
    testCase.config.accounts ?? []
  ).map((account) => ({
    slug: account.slug,
    name: account.name,
    trading: { notes: account.trading?.notes ?? "" },
  }));

  return {
    testCase: testCaseSummary,
    accounts,
    exchangeType: testCase.config.management.exchangeType,
    productionHistory: testCase.tradeHistory.filter((position) =>
      Boolean(position.closed),
    ),
    backtestHistory: result.positions.filter((position) =>
      Boolean(position.closed),
    ),
  };
}

const precisionChecker = {
  testCases: {
    list,
  },
  run,
} as const;

export default precisionChecker;
