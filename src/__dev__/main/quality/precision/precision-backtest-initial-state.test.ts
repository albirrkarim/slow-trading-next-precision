import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPosition } from "../fixtures/position";
import { windowsMs } from "@/lib/dynamic/constants-time";
import { precisionBacktest } from "@/lib/dev/backtestPrecision/backtest";
import type { PrecisionTestCase } from "@/lib/production/precision-test-case";

const mocks = vi.hoisted(() => ({
  createInitialBalance: vi.fn(() => ({ generated: true })),
  createInitialVPointsMap: vi.fn(async () => ({ GENERATED: [] })),
  dataset: {
    startTime: 0,
    endTime: 10_000_000_000_000,
    symbols: ["SUI"],
    getKlines: vi.fn(),
  },
  engineAdapter: undefined as any,
  engineState: undefined as any,
  preparePrecisionDataset: vi.fn(),
}));

mocks.preparePrecisionDataset.mockImplementation(async () => mocks.dataset);

vi.mock("@/lib/dev/backtestPrecision/backtest/data", () => ({
  preparePrecisionDataset: mocks.preparePrecisionDataset,
}));

vi.mock("@/lib/dev/backtestPrecision/backtest/utils", () => ({
  createInitialBalance: mocks.createInitialBalance,
  createInitialVPointsMap: mocks.createInitialVPointsMap,
  createProgressLogger: () => () => undefined,
}));

vi.mock("@/lib/precision", () => ({
  RuntimeEngine: class {
    constructor(state: unknown, adapter: unknown) {
      mocks.engineState = state;
      mocks.engineAdapter = adapter;
    }

    async start() {}
  },
}));

const config = {
  management: { exchangeType: "binance", symbols: ["SUI"] },
  runtime: {},
  accounts: [],
} as unknown as PrecisionTestCase["config"];

function params(overrides: Record<string, unknown> = {}) {
  return {
    config,
    endTime: 10_000_000_000,
    range: "custom",
    startTime: 4_000,
    upToDateDecisionBacktest: false,
    upToDateKlines: false,
    verbose: false,
    ...overrides,
  };
}

describe("precision backtest initial state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.engineState = undefined;
    mocks.engineAdapter = undefined;
  });

  it("fails clearly in checker mode without a captured initial state", async () => {
    await expect(
      precisionBacktest(params({ mode: "precision-checker" }) as any),
    ).rejects.toThrow(/requires a captured initial runtime state/);
  });

  it("fails clearly in checker mode without finite start and end times", async () => {
    const initialState = {
      balance: {},
      openPositions: [],
      vPointsMap: {},
    } as unknown as PrecisionTestCase["initialState"];

    await expect(
      precisionBacktest(
        params({
          initialState,
          mode: "precision-checker",
          startTime: undefined,
        }) as any,
      ),
    ).rejects.toThrow(/requires finite startTime and endTime/);
  });

  it("restores snapshot time, balance, open positions, and vPoints for checker replays", async () => {
    const initialState = {
      balance: { "acc-1": { availableQuoteAsset: 42 } },
      openPositions: [createTestPosition({ symbol: "SUI" })],
      vPointsMap: { SUI: [{ id: "p1", lvl: -2, t: 1 }] },
    } as unknown as PrecisionTestCase["initialState"];

    await precisionBacktest(
      params({ initialState, mode: "precision-checker" }) as any,
    );

    expect(mocks.engineState.currentTime).toBe(4_000);
    expect(mocks.engineState.balance).toEqual(initialState.balance);
    expect(mocks.engineState.balance).not.toBe(initialState.balance);
    expect(mocks.engineState.openPositions).toEqual(
      initialState.openPositions,
    );
    expect(mocks.engineState.openPositions).not.toBe(
      initialState.openPositions,
    );
    expect(mocks.engineState.vPointsMap).toEqual(initialState.vPointsMap);
    expect(mocks.engineState.vPointsMap).not.toBe(initialState.vPointsMap);
    expect(mocks.createInitialBalance).not.toHaveBeenCalled();
    expect(mocks.createInitialVPointsMap).not.toHaveBeenCalled();

    await expect(
      mocks.engineAdapter.onStrategy(
        { type: "entry" },
        { state: { currentTime: 10_000_000_000_000 } },
      ),
    ).resolves.toBe(true);
  });

  it("ignores an accidental initialState and keeps ordinary generated state", async () => {
    const accidentalInitialState = {
      balance: { "acc-1": { available: 7 } },
      openPositions: [createTestPosition({ symbol: "SUI" })],
      vPointsMap: { SUI: [{ id: "px", lvl: -1, t: 1 }] },
    };

    await precisionBacktest(
      params({
        initialState: accidentalInitialState,
        mode: "backtest",
      }) as any,
    );

    expect(mocks.engineState.currentTime).toBe(
      mocks.dataset.startTime + windowsMs["1m"] * 2,
    );
    expect(mocks.engineState.balance).toEqual({ generated: true });
    expect(mocks.engineState.openPositions).toEqual([]);
    expect(mocks.engineState.vPointsMap).toEqual({ GENERATED: [] });
    expect(mocks.createInitialBalance).toHaveBeenCalledTimes(1);
    expect(mocks.createInitialVPointsMap).toHaveBeenCalledTimes(1);
    expect(
      mocks.preparePrecisionDataset.mock.calls[0][0].initialState,
    ).toBeUndefined();

    await expect(
      mocks.engineAdapter.onStrategy(
        { type: "entry" },
        { state: { currentTime: 10_000_000_000_000 } },
      ),
    ).resolves.toBe(false);
  });
});
