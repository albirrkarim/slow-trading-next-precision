import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  root: `/tmp/precision-recorder-black-swan-${process.pid}`,
}));

vi.mock("@/lib/system/storage/root", () => ({
  default: { resolve: () => mocks.root },
}));

import type { RuntimeEngineState } from "@/lib/precision/types";
import recorder from "@/lib/production/precision-test-case/recorder";
import { runtimeStorage } from "@/lib/system/storage";
import type { BlackSwanState } from "@/lib/system/trading/black-swan";

const NOW = Date.UTC(2026, 0, 1, 12, 0);

function stateWith(blackSwanStatus: BlackSwanState | undefined) {
  return {
    balance: {},
    blackSwanProtective:
      blackSwanStatus === undefined
        ? true
        : blackSwanStatus.status !== "NORMAL",
    blackSwanStatus,
    config: {
      accounts: [],
      management: { symbols: [] },
      runtime: {},
    },
    currentTime: NOW,
    markPriceMap: { BTC: { price: 1 } },
    mode: "sandbox",
    openPositions: [],
    vPointsMap: { BTC: [] },
  } as unknown as RuntimeEngineState;
}

function pendingFile(fileName: string): string {
  return path.join(mocks.root, "dev", "precision-test-case", fileName);
}

describe("precision test case recorder Black Swan state", () => {
  beforeEach(async () => {
    await fs.remove(mocks.root);
    vi.spyOn(runtimeStorage.history, "readRange").mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(mocks.root);
  });

  it("deep-copies the rich state into initial and end snapshots", async () => {
    const status = {
      evidence: {
        btc: { 5: { baseline: 100, current: 90, low: 89, pct: -10, t: 1 } },
      },
      reason: "BTC_HARD_TRIGGER",
      since: NOW - 1000,
      status: "CRISIS",
      t: NOW,
    } as unknown as BlackSwanState;
    const state = stateWith(status);

    const started = await recorder.start(state);
    const written = await fs.readJSON(pendingFile(started.fileName!));

    expect(written.initialState.blackSwanStatus).toEqual(status);
    expect(written.initialState.blackSwanStatus).not.toBe(status);
    expect(written.initialState.blackSwanProtective).toBe(true);

    (state.blackSwanStatus as { status: string }).status = "NORMAL";
    const reloaded = await fs.readJSON(pendingFile(started.fileName!));
    expect(reloaded.initialState.blackSwanStatus.status).toBe("CRISIS");

    const ended = await recorder.end(
      stateWith({
        reason: "HEALTHY",
        since: NOW + 1000,
        status: "NORMAL",
        t: NOW + 1000,
      }),
    );
    expect(ended.testCase.initialState.blackSwanStatus?.status).toBe("CRISIS");
    expect(ended.testCase.endState?.blackSwanStatus?.status).toBe("NORMAL");
    expect(ended.testCase.endState?.blackSwanProtective).toBe(false);
  });

  it("omits the field for captures recorded before full state existed", async () => {
    const state = stateWith(undefined);
    const started = await recorder.start(state);
    const written = await fs.readJSON(pendingFile(started.fileName!));

    expect(written.initialState.blackSwanProtective).toBe(true);
    expect(written.initialState.blackSwanStatus).toBeUndefined();

    const ended = await recorder.end(state);
    expect(ended.testCase.endState?.blackSwanStatus).toBeUndefined();
    expect(ended.testCase.endState?.blackSwanProtective).toBe(true);
  });
});
