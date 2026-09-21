import fs from "fs-extra";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPosition } from "../fixtures/position";
import precisionChecker from "@/lib/dev/precisionChecker";
import type { PrecisionTestCase } from "@/lib/production/precision-test-case";

const mocks = vi.hoisted(() => ({
  precisionBacktest: vi.fn(),
  root: `/tmp/precision-checker-${process.pid}`,
}));

vi.mock("@/lib/persistent-storage-root", () => ({
  resolvePersistentStorageRoot: () => mocks.root,
}));

vi.mock("@/lib/dev/backtestPrecision/backtest", () => ({
  precisionBacktest: mocks.precisionBacktest,
}));

const directory = path.join(mocks.root, "dev", "precision-test-case");

function testConfig(overrides: Record<string, unknown> = {}) {
  return {
    management: { exchangeType: "binance" },
    runtime: {},
    accounts: [
      { slug: "acc-1", name: "Account 1", trading: { notes: "Desk notes" } },
    ],
    ...overrides,
  } as unknown as PrecisionTestCase["config"];
}

function balanceSummary(total: number) {
  return {
    available: total,
    locked: 0,
    reserved: 0,
    safeHaven: 0,
    spendable: total,
    startingBalance: total,
    total,
  };
}

function initialState(t: number): PrecisionTestCase["initialState"] {
  return {
    t,
    balance: { "acc-1": balanceSummary(100) },
    openPositions: [],
    vPointsMap: { SUI: [{ id: "p1", t: t - 60_000, lvl: -2 }] },
  } as unknown as PrecisionTestCase["initialState"];
}

async function writeCase(fileName: string, testCase: unknown) {
  await fs.ensureDir(directory);
  await fs.writeJSON(path.join(directory, fileName), testCase);
}

function completedCase(endTime: number, tradeCount = 1): PrecisionTestCase {
  const startTime = endTime - 60_000;
  return {
    config: testConfig(),
    initialState: initialState(startTime),
    startTime,
    endTime,
    tradeHistory: Array.from({ length: tradeCount }, () =>
      createTestPosition({
        closed: { t: endTime, price: 11, feeUsdt: 0, reason: "TAKE_PROFIT" },
      }),
    ),
  };
}

describe("precision checker service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.remove(mocks.root);
  });

  afterAll(async () => {
    await fs.remove(mocks.root);
  });

  it("returns an empty list when the capture directory is missing", async () => {
    await expect(precisionChecker.testCases.list()).resolves.toEqual([]);
  });

  it("lists only completed valid captures, newest endTime first", async () => {
    await writeCase(
      "sandbox-01-01-2024-00-00-03-01-2024-00-00.json",
      completedCase(3, 2),
    );
    await writeCase(
      "live-01-01-2024-00-00-05-01-2024-00-00.json",
      completedCase(5),
    );
    await writeCase(
      "live-01-01-2024-00-00-undefined.json",
      completedCase(9),
    );
    await writeCase("notes.txt", completedCase(8));
    await writeCase("live-01-01-2024-00-00-07-01-2024-00-00.json", {
      config: testConfig(),
      startTime: 6,
      endTime: 7,
      initialVPointsMap: { SUI: [] },
      tradeHistory: [],
    });

    const list = await precisionChecker.testCases.list();

    expect(list.map((testCase) => testCase.fileName)).toEqual([
      "live-01-01-2024-00-00-05-01-2024-00-00.json",
      "sandbox-01-01-2024-00-00-03-01-2024-00-00.json",
    ]);
    expect(list[0]).toMatchObject({ mode: "live", endTime: 5, tradeCount: 1 });
    expect(list[1]).toMatchObject({
      mode: "sandbox",
      endTime: 3,
      tradeCount: 2,
    });
  });

  it("rejects file names that are not completed capture basenames", async () => {
    await expect(
      precisionChecker.run("../secret.json"),
    ).rejects.toThrow(/Invalid precision test case file name/);
    await expect(
      precisionChecker.run("nested/live-01-01-2024-00-00-02-01-2024-00-00.json"),
    ).rejects.toThrow(/Invalid precision test case file name/);
    await expect(
      precisionChecker.run("live-01-01-2024-00-00-undefined.json"),
    ).rejects.toThrow(/Invalid precision test case file name/);
    await expect(
      precisionChecker.run("other-01-01-2024-00-00.json"),
    ).rejects.toThrow(/Invalid precision test case file name/);
  });

  it("rejects a completed-name capture without a valid initialState", async () => {
    const fileName = "live-01-01-2024-00-00-02-01-2024-00-00.json";
    await writeCase(fileName, {
      config: testConfig(),
      startTime: 1,
      endTime: 2,
      tradeHistory: [],
    });

    await expect(precisionChecker.run(fileName)).rejects.toThrow(
      `Invalid precision test case: ${fileName}`,
    );
    expect(mocks.precisionBacktest).not.toHaveBeenCalled();
  });

  it("rejects captures whose initialState maps are arrays", async () => {
    const fileName = "sandbox-02-01-2024-00-00-03-01-2024-00-00.json";
    await writeCase(fileName, {
      config: testConfig(),
      initialState: {
        t: 1,
        balance: [],
        openPositions: [],
        vPointsMap: [],
      },
      startTime: 1,
      endTime: 2,
      tradeHistory: [],
    });

    await expect(precisionChecker.testCases.list()).resolves.toEqual([]);
    await expect(precisionChecker.run(fileName)).rejects.toThrow(
      `Invalid precision test case: ${fileName}`,
    );
    expect(mocks.precisionBacktest).not.toHaveBeenCalled();
  });

  it("replays a capture with exact precision-checker params and closed-only histories", async () => {
    const fileName = "sandbox-01-01-2024-00-00-02-01-2024-00-00.json";
    const closedProduction = createTestPosition({
      symbol: "SUI",
      closed: { t: 2, price: 11, feeUsdt: 0, reason: "TAKE_PROFIT" },
    });
    const openProduction = createTestPosition({ symbol: "OPEN-PROD" });
    const snapshot = initialState(1);
    await writeCase(fileName, {
      config: testConfig(),
      initialState: snapshot,
      startTime: 1,
      endTime: 2,
      tradeHistory: [closedProduction, openProduction],
    });

    const closedBacktest = createTestPosition({
      symbol: "BACK",
      closed: { t: 2, price: 12, feeUsdt: 0, reason: "TAKE_PROFIT" },
    });
    const openBacktest = createTestPosition({ symbol: "OPEN-BACK" });
    mocks.precisionBacktest.mockResolvedValue({
      exchangeType: "binance",
      vPointsMap: {},
      positions: [closedBacktest, openBacktest],
    });

    const result = await precisionChecker.run(fileName);

    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(1);
    expect(mocks.precisionBacktest).toHaveBeenCalledWith({
      config: expect.objectContaining({
        management: { exchangeType: "binance" },
      }),
      startTime: 1,
      endTime: 2,
      range: "custom",
      initialState: snapshot,
      mode: "precision-checker",
      upToDateDecisionBacktest: false,
      upToDateKlines: false,
      verbose: false,
    });

    expect(result.testCase).toEqual({
      fileName,
      mode: "sandbox",
      startTime: 1,
      endTime: 2,
      tradeCount: 2,
    });
    expect(result.exchangeType).toBe("binance");
    expect(result.accounts).toEqual([
      { slug: "acc-1", name: "Account 1", trading: { notes: "Desk notes" } },
    ]);
    expect(result.productionHistory).toEqual([closedProduction]);
    expect(result.backtestHistory).toEqual([closedBacktest]);
  });
});
