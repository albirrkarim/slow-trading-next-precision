import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import type { BacktestPrecisionResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { storageFiles } from "@/lib/system/storage";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpRoot: string | null = null;
let previousRoot: string | undefined;

const RESULT: BacktestPrecisionResult = {
  balanceSnapshots: [],
  exchangeType: "binance",
  positions: [],
  vPointsMap: {},
};

const IDENTITY = {
  config: {
    accounts: [{ credentials: { apiKey: "SECRET-KEY" }, enabled: true }],
    management: { symbols: ["BTC"] },
  },
  range: "1year",
};

describe("backtest result cache", () => {
  beforeEach(async () => {
    previousRoot = process.env.PERSISTENT_STORAGE_ROOT;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "backtest-cache-"));
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
  });

  afterEach(async () => {
    if (tmpRoot) {
      await fs.remove(tmpRoot);
      tmpRoot = null;
    }
    if (previousRoot === undefined) {
      delete process.env.PERSISTENT_STORAGE_ROOT;
    } else {
      process.env.PERSISTENT_STORAGE_ROOT = previousRoot;
    }
  });

  it("produces the same key regardless of config field order", () => {
    const reordered = {
      config: {
        management: { symbols: ["BTC"] },
        accounts: [{ enabled: true, credentials: { apiKey: "SECRET-KEY" } }],
      },
      range: "1year",
    };

    expect(backtestResultCache.key(IDENTITY)).toBe(
      backtestResultCache.key(reordered),
    );
  });

  it("produces different keys for different identities", () => {
    const otherRange = backtestResultCache.key({
      ...IDENTITY,
      range: "6month",
    });
    const otherBounds = backtestResultCache.key({
      ...IDENTITY,
      endTime: 2,
      range: "custom",
      startTime: 1,
    });

    const base = backtestResultCache.key(IDENTITY);
    expect(otherRange).not.toBe(base);
    expect(otherBounds).not.toBe(base);
  });

  it("returns null on miss and on a corrupt file", async () => {
    const key = backtestResultCache.key(IDENTITY);

    expect(await backtestResultCache.read(key)).toBeNull();

    const file = path.join(storageFiles.dev.backtestResults, `${key}.json`);
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, "{not-json");
    expect(await backtestResultCache.read(key)).toBeNull();

    await fs.writeJson(file, { v: 999, result: RESULT });
    expect(await backtestResultCache.read(key)).toBeNull();
  });

  it("round-trips a result without persisting raw credentials", async () => {
    const key = backtestResultCache.key(IDENTITY);

    await backtestResultCache.write({
      key,
      range: "1year",
      result: RESULT,
    });

    expect(await backtestResultCache.read(key)).toEqual(RESULT);

    const file = path.join(storageFiles.dev.backtestResults, `${key}.json`);
    const stored = await fs.readFile(file, "utf8");
    expect(stored).not.toContain("SECRET-KEY");
  });
});
