import fs from "fs-extra";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import backtestMcp from "@/lib/dev/backtestPrecision/mcp";
import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import runtimeMcpTools from "@/lib/system/mcp/tools";
import type { RuntimeMcpAuthenticatedToken } from "@/lib/system/mcp/types";
import type { RuntimeMcpTokenRecord } from "@/lib/system/runtime/types";

backtestMcp.register();

const auth: RuntimeMcpAuthenticatedToken = {
  permissions: new Set(["backtest.read"]),
  token: {
    createdAt: 1,
    enabled: true,
    id: "tok",
    name: "test",
    permissions: ["backtest.read"],
    tokenHash: "hash",
    tokenSecretEncrypted: "enc",
  } satisfies RuntimeMcpTokenRecord,
};

async function statusOf(cacheKey: string) {
  return (await runtimeMcpTools.call({
    arguments: { cacheKey },
    auth,
    devToolsEnabled: true,
    name: "backtest_run_status",
  })) as { status: string; error?: string };
}

describe("MCP backtest_run_status", () => {
  const key = backtestResultCache.key({
    config: { test: randomUUID() },
    range: "1month",
  });
  const stagingDir = `${backtestResultCache.dir}/.staging/${key}-testrun`;
  const markerPath = `${backtestResultCache.dir}/.failed/${key}.json`;

  afterEach(async () => {
    await fs.remove(stagingDir);
    await fs.remove(markerPath);
  });

  it("reports unknown for a key with no run state", async () => {
    expect((await statusOf(key)).status).toBe("unknown");
  });

  it("reports failed with the recorded error", async () => {
    await backtestResultCache.markFailed(key, new Error("boom"));
    const result = await statusOf(key);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("boom");
  });

  it("reports running while a fresh staging dir exists", async () => {
    await fs.ensureDir(stagingDir);
    expect((await statusOf(key)).status).toBe("running");
  });

  it("reports interrupted when the staging dir is stale", async () => {
    await fs.ensureDir(stagingDir);
    const stale = new Date(Date.now() - 60 * 60_000);
    await fs.utimes(stagingDir, stale, stale);
    expect((await statusOf(key)).status).toBe("interrupted");
  });
});
