import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";

describe("backtest cache failure markers", () => {
  const key = backtestResultCache.key({
    config: { test: randomUUID() },
    range: "6month",
  });
  const markerPath = path.join(
    backtestResultCache.dir,
    ".failed",
    `${key}.json`,
  );

  afterEach(async () => {
    await fs.remove(markerPath);
  });

  it("records, reads, and clears a failed run by cache key", async () => {
    expect(await backtestResultCache.readFailed(key)).toBeNull();

    await backtestResultCache.markFailed(key, new Error("worker died"));
    const record = await backtestResultCache.readFailed(key);
    expect(record?.error).toBe("worker died");
    expect(typeof record?.t).toBe("number");

    await backtestResultCache.clearFailed(key);
    expect(await backtestResultCache.readFailed(key)).toBeNull();
    expect(await fs.pathExists(markerPath)).toBe(false);
  });

  it("accepts non-Error values and never throws on write problems", async () => {
    await backtestResultCache.markFailed(key, "plain failure");
    expect((await backtestResultCache.readFailed(key))?.error).toBe(
      "plain failure",
    );

    // A directory at the marker path makes the write fail — the call must
    // still resolve so run error handling never loses the original error.
    await fs.remove(markerPath);
    await fs.ensureDir(markerPath);
    await expect(
      backtestResultCache.markFailed(key, new Error("ignored")),
    ).resolves.toBeUndefined();
    await fs.remove(markerPath);
  });
});
