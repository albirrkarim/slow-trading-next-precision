import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveVolatilityRetracePct,
  resolveVolatilityThreshold,
  VOLATILITY_RETRACE_PERCENT,
  VOLATILITY_THRESHOLD,
} from "@/lib/system/constants";
import { makeConfigDraft } from "@/components/settings/helpers";
import { createInitialVPointsMap } from "@/lib/dev/backtestPrecision/backtest/utils";
import vpoints from "@/lib/system/utils/vpoints";

const FIVE_MINUTES_MS = 5 * 60_000;
const BASE_TIME = 1_700_000_000_000;

function makeKline(openTime: number, close: number) {
  return [
    openTime,
    String(close),
    String(close),
    String(close),
    String(close),
    "1",
    openTime + FIVE_MINUTES_MS - 1,
    "1",
    1,
    "1",
    "1",
    "0",
  ] as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("volatility detector config resolvers", () => {
  it("falls back to the environment defaults when the fields are absent", () => {
    expect(resolveVolatilityThreshold(undefined)).toBe(VOLATILITY_THRESHOLD);
    expect(resolveVolatilityRetracePct(undefined)).toBe(
      VOLATILITY_RETRACE_PERCENT,
    );
    expect(resolveVolatilityThreshold({})).toBe(VOLATILITY_THRESHOLD);
    expect(resolveVolatilityRetracePct({})).toBe(VOLATILITY_RETRACE_PERCENT);
  });

  it("returns the management overrides when both are finite positive", () => {
    const management = { volatilityRetracePct: 0.5, volatilityThreshold: 8 };
    expect(resolveVolatilityThreshold(management)).toBe(8);
    expect(resolveVolatilityRetracePct(management)).toBe(0.5);
  });

  it("ignores zero, negative, and non-finite values independently", () => {
    for (const invalid of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveVolatilityThreshold({ volatilityThreshold: invalid }),
      ).toBe(VOLATILITY_THRESHOLD);
      expect(
        resolveVolatilityRetracePct({ volatilityRetracePct: invalid }),
      ).toBe(VOLATILITY_RETRACE_PERCENT);
    }
    // A partial override leaves the other control on the env default.
    expect(resolveVolatilityThreshold({ volatilityRetracePct: 0.5 })).toBe(
      VOLATILITY_THRESHOLD,
    );
    expect(resolveVolatilityRetracePct({ volatilityThreshold: 8 })).toBe(
      VOLATILITY_RETRACE_PERCENT,
    );
  });
});

describe("createInitialVPointsMap — backtest warm-up detection", () => {
  const klines = [100, 104, 108].map((close, index) =>
    makeKline(BASE_TIME + index * FIVE_MINUTES_MS, close),
  );

  it("forwards the resolved management params to the detector", async () => {
    const spy = vi.spyOn(vpoints, "detectVPoints").mockReturnValue([]);
    await createInitialVPointsMap(
      ["SUI"],
      async () => klines,
      BASE_TIME,
      BASE_TIME + 10 * FIVE_MINUTES_MS,
      { volatilityRetracePct: 0.5, volatilityThreshold: 8 },
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        moveThreshold: 8,
        retracePercent: 0.5,
        symbol: "SUI",
      }),
    );
  });

  it("forwards the env defaults when no override is configured", async () => {
    const spy = vi.spyOn(vpoints, "detectVPoints").mockReturnValue([]);
    await createInitialVPointsMap(
      ["SUI"],
      async () => klines,
      BASE_TIME,
      BASE_TIME + 10 * FIVE_MINUTES_MS,
      undefined,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        moveThreshold: VOLATILITY_THRESHOLD,
        retracePercent: VOLATILITY_RETRACE_PERCENT,
      }),
    );
  });

  it("honors the overrides in real detection — a higher bar emits fewer pivots", () => {
    // +8% then −7%: activates UP under the env default (<=8%) but never
    // under moveThreshold 20; the 7% retrace confirms a TOP under the env
    // default but never under retracePercent 50.
    const swings = [100, 104, 108, 106.8, 102, 100].map((close, index) =>
      makeKline(BASE_TIME + index * FIVE_MINUTES_MS, close),
    );

    expect(
      vpoints.detectVPoints({ klines: swings, symbol: "SUI" }).length,
    ).toBeGreaterThan(0);
    expect(
      vpoints.detectVPoints({
        klines: swings,
        moveThreshold: 20,
        symbol: "SUI",
      }),
    ).toEqual([]);
    expect(
      vpoints.detectVPoints({
        klines: swings,
        retracePercent: 50,
        symbol: "SUI",
      }),
    ).toEqual([]);
  });
});

describe("makeConfigDraft — detector fields survive the settings draft", () => {
  it("copies both management detector fields into the draft", () => {
    const draft = makeConfigDraft({
      accounts: [],
      config: {
        symbols: ["SUI"],
        volatilityRetracePct: 0.5,
        volatilityThreshold: 8,
      },
      runtime: {},
    } as never);

    expect(draft.management.volatilityThreshold).toBe(8);
    expect(draft.management.volatilityRetracePct).toBe(0.5);
  });
});
