import { describe, expect, it } from "vitest";

import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import { ProductionRuntime } from "@/lib/production/runtime";

const MINUTE_MS = 60_000;

function capture(runtime: ProductionRuntime): {
  error?: string;
  state?: RuntimeEngineState;
} {
  try {
    return { state: runtime.captureState() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

describe("ProductionRuntime.captureState", () => {
  it("rejects before the engine is ready, while a stage runs, and returns an isolated clone in between", async () => {
    const runtime = new ProductionRuntime();

    expect(capture(runtime).error).toMatch(/not ready/);

    const state = {
      balance: {
        "acc-1": {
          available: 42,
          locked: 0,
          reserved: 0,
          safeHaven: 0,
          spendable: 42,
          startingBalance: 42,
          total: 42,
        },
      },
      config: {
        management: { exchangeType: "binance", symbols: ["SUI"] },
        runtime: {
          runnerEnabled: true,
          standardMonitoringStageIntervalMinutes: 1,
          captureEntryStageIntervalMinutes: 4,
          speedupStageIntervalMinutes: 1,
        },
        accounts: [],
      },
      currentTime: 2 * MINUTE_MS,
      markPriceMap: {},
      mode: "sandbox",
      openPositions: [],
      vPointsMap: {},
    } as unknown as RuntimeEngineState;

    const attempts: Array<{ error?: string; state?: RuntimeEngineState }> = [];
    let clockTime = state.currentTime;
    let finished = false;
    let captured: RuntimeEngineState | undefined;

    const markPriceKline = [
      0,
      "1",
      "2",
      "1",
      "1.5",
      "1",
      1,
      "1",
      1,
      "1",
      "1",
      "1",
    ];

    const adapter: RuntimeEngineAdapter = {
      clock: {
        advanceTo(time) {
          clockTime = Math.min(time, Number.MAX_SAFE_INTEGER);
          captured = runtime.captureState();
        },
        finished() {
          const done = finished;
          finished = true;
          return done;
        },
        now() {
          return clockTime;
        },
      },
      exchange: {
        getFeeRate: () => 0,
        getRoundTripFeeRate: () => 0,
      },
      market: {
        async getKlines(props) {
          const attempt = capture(runtime);
          attempts.push(attempt);
          if (attempt.error?.includes("processing a trading stage")) {
            const abort = new Error("stop after observing processing");
            abort.name = "AbortError";
            throw abort;
          }
          if (props.minutes === undefined) {
            return [];
          }
          return [markPriceKline as never];
        },
      },
      onAction: async () => null,
      onExit: async () => undefined,
      onNotif: () => true,
      onStrategy: async () => true,
    };

    await runtime.start({
      createAdapter: () => adapter,
      createState: () => state,
    });

    // Initial mark-price/vPoints updates run before the engine is ready.
    expect(attempts.length).toBeGreaterThanOrEqual(3);
    expect(attempts[0].error).toMatch(/not ready/);
    expect(attempts.at(-1)?.error).toMatch(/processing a trading stage/);

    // advanceTo runs while ready and idle, so the snapshot succeeds there.
    expect(captured).toBeDefined();
    expect(captured).not.toBe(state);
    expect(captured?.openPositions).not.toBe(state.openPositions);
    expect(captured?.balance["acc-1"].available).toBe(42);

    state.balance["acc-1"].available = 999;
    expect(captured?.balance["acc-1"].available).toBe(42);

    // Once the run exits the engine is cleared again.
    expect(capture(runtime).error).toMatch(/not ready/);
  });
});
