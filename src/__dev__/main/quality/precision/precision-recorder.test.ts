import fs from "fs-extra";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPosition } from "../fixtures/position";
import type { RuntimeEngineState } from "@/lib/precision/types";
import recorder from "@/lib/production/precision-test-case";

const mocks = vi.hoisted(() => ({
  readRange: vi.fn(async () => []),
  root: `/tmp/precision-recorder-${process.pid}`,
}));

vi.mock("@/lib/persistent-storage-root", () => ({
  resolvePersistentStorageRoot: () => mocks.root,
}));

vi.mock("@/lib/slowTrading/storage", () => ({
  default: { history: { readRange: mocks.readRange } },
}));

const directory = path.join(mocks.root, "dev", "precision-test-case");

function vPoint(id: string, t: number, extra: Record<string, unknown> = {}) {
  return { id, l: "T", lvl: 1, p: 10, t, ...extra };
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

function runtimeState(
  overrides: Partial<RuntimeEngineState> = {},
): RuntimeEngineState {
  const startTime = Date.UTC(2024, 0, 2, 12, 0);
  return {
    mode: "sandbox",
    currentTime: startTime,
    config: {
      management: {
        exchangeType: "binance",
        symbols: ["SUI"],
      },
      runtime: {},
      accounts: [
        {
          slug: "acc-1",
          name: "Account 1",
          credentials: { apiKey: "secret", apiSecret: "secret" },
          trading: { notes: "Desk notes" },
        },
      ],
    },
    balance: { "acc-1": balanceSummary(42) },
    openPositions: [],
    vPointsMap: {
      SUI: Array.from({ length: 15 }, (_, index) =>
        vPoint(`p${index + 1}`, index + 1),
      ),
      BTC: [],
    },
    markPriceMap: {
      SUI: { lastUpdated: startTime, price: 1.5 },
      BTC: { lastUpdated: startTime, price: 50_000 },
    },
    ...overrides,
  } as unknown as RuntimeEngineState;
}

async function readPendingCase(): Promise<Record<string, any>> {
  const files = await fs.readdir(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^sandbox-.*-undefined\.json$/);
  return fs.readJSON(path.join(directory, files[0]));
}

describe("precision test-case recorder", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.remove(mocks.root);
  });

  afterAll(async () => {
    await fs.remove(mocks.root);
  });

  it("rejects when the runtime snapshot is not ready", async () => {
    await expect(
      recorder.start(runtimeState({ mode: "backtest" })),
    ).rejects.toThrow(/only be recorded in production mode/);

    await expect(
      recorder.start(runtimeState({ currentTime: Number.NaN })),
    ).rejects.toThrow(/currentTime is not finite/);

    const missingVPoints = runtimeState();
    delete missingVPoints.vPointsMap.BTC;
    await expect(recorder.start(missingVPoints)).rejects.toThrow(
      /Missing vPoints: BTC/,
    );

    const missingPrice = runtimeState();
    missingPrice.markPriceMap.SUI = { lastUpdated: 1, price: 0 };
    await expect(recorder.start(missingPrice)).rejects.toThrow(
      /Missing mark price: SUI/,
    );
  });

  it("writes an initialState snapshot with cloned balance, open positions, and bounded vPoints", async () => {
    const state = runtimeState();
    const openPosition = createTestPosition({
      account: "acc-1",
      entryId: "p1",
      entryTime: 8,
      symbol: "SUI",
      vPoints: [{ id: "p2", lvl: 2 }],
    });
    const closedPosition = createTestPosition({
      closed: { t: 9, price: 11, feeUsdt: 0, reason: "TAKE_PROFIT" },
      symbol: "SUI",
    });
    state.openPositions = [openPosition, closedPosition];
    (state.vPointsMap.SUI[0] as unknown as Record<string, unknown>).usedByAcc1 =
      true;

    await recorder.start(state);

    const written = await readPendingCase();
    expect(written.startTime).toBe(state.currentTime);
    expect(written.tradeHistory).toEqual([]);
    expect(written).not.toHaveProperty("initialVPointsMap");
    expect(written).not.toHaveProperty("endState");
    expect(written.initialState).not.toHaveProperty("markPriceMap");

    expect(written.initialState).not.toHaveProperty("t");
    expect(written.initialState.balance).toEqual(state.balance);
    expect(written.initialState.balance).not.toBe(state.balance);
    expect(written.initialState.openPositions).toEqual(state.openPositions);
    expect(written.initialState.openPositions).not.toBe(state.openPositions);

    const retained = written.initialState.vPointsMap.SUI.map(
      (point: { id: string }) => point.id,
    );
    expect(retained).toEqual([
      "p1",
      "p2",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
      "p11",
      "p12",
      "p13",
      "p14",
      "p15",
    ]);
    expect(written.initialState.vPointsMap.SUI[0].usedByAcc1).toBe(true);
    expect(written.initialState.vPointsMap.BTC).toEqual([]);

    expect(written.config.accounts[0].credentials).toEqual({
      apiKey: "",
      apiSecret: "",
    });
    expect(state.balance["acc-1"].available).toBe(42);
  });

  it("writes an endState snapshot with cloned balance, open positions, and a vPoints delta", async () => {
    const state = runtimeState();
    await recorder.start(state);

    const endTime = state.currentTime + 60_000;
    const end = runtimeState({ currentTime: endTime });
    end.balance["acc-1"].available = 30;
    end.openPositions = [
      createTestPosition({ account: "acc-1", symbol: "SUI" }),
    ];
    end.vPointsMap.SUI = end.vPointsMap.SUI.slice(5);
    (end.vPointsMap.SUI[9] as unknown as Record<string, unknown>).usedByAcc1 =
      true;
    (end.vPointsMap.SUI as unknown[]).push(vPoint("p16", 16));

    const result = await recorder.end(end);

    const files = await fs.readdir(directory);
    expect(files).toEqual([result.fileName]);
    expect(files[0]).not.toContain("undefined");
    const written = await fs.readJSON(
      path.join(directory, result.fileName),
    );

    expect(written.endTime).toBe(endTime);
    expect(written.endState.balance).toEqual(end.balance);
    expect(written.endState.balance).not.toBe(end.balance);
    expect(written.endState.openPositions).toEqual(end.openPositions);
    expect(written.endState.openPositions).not.toBe(end.openPositions);
    expect(
      written.endState.vPointsMap.SUI.map(
        (point: { id: string }) => point.id,
      ),
    ).toEqual(["p15", "p16"]);
    expect(written.endState.vPointsMap.SUI[0].usedByAcc1).toBe(true);
    expect(written.endState.vPointsMap).not.toHaveProperty("BTC");
  });

  it("lists only completed files carrying an endState", async () => {
    await recorder.start(runtimeState());
    const result = await recorder.end(
      runtimeState({ currentTime: Date.UTC(2024, 0, 2, 13, 0) }),
    );
    await fs.writeJSON(
      path.join(
        directory,
        "live-01-01-2024-00-00-02-01-2024-00-00.json",
      ),
      { startTime: 1, endTime: 2, tradeHistory: [] },
    );

    const list = await recorder.files.list();

    expect(list.map((file) => file.fileName)).toEqual([result.fileName]);
  });
});
