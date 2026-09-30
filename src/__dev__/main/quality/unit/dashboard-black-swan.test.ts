import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountLoad: vi.fn(async () => ({
    balance: { quoteAsset: 100 },
    positions: [],
  })),
  catalogEnsure: vi.fn(),
  historyReadAll: vi.fn(async () => []),
  statusLoad: vi.fn(async () => ({})),
  strategyLoad: vi.fn(async () => undefined),
}));

vi.mock("@/lib/system/storage/runtime", () => ({
  default: {
    account: { load: mocks.accountLoad },
    catalog: { ensure: mocks.catalogEnsure },
    history: { readAll: mocks.historyReadAll },
    status: { load: mocks.statusLoad },
    strategy: { load: mocks.strategyLoad },
  },
}));

vi.mock("@/lib/system/storage/binance-health", () => ({
  default: {
    snapshot: { read: vi.fn(async () => ({ current: null, logs: [] })) },
  },
}));

vi.mock("@/lib/system/storage/instance-ip", () => ({
  default: { storage: { read: vi.fn(async () => null) } },
}));

import systemDashboard from "@/lib/system/dashboard";
import type { RuntimeAccountConfig, RuntimeConfig } from "@/lib/system/runtime";
import type { BlackSwanTimeline } from "@/lib/system/trading/black-swan";

const ACCOUNT = {
  enabled: true,
  slug: "acc-1",
  trading: {},
} as unknown as RuntimeAccountConfig;

const CONFIG = {
  accounts: [ACCOUNT],
  management: {
    exchangeType: "binance",
    symbols: ["SUI"],
    tradingMode: "spot",
  },
  runtime: {},
} as unknown as RuntimeConfig;

const SOURCE = {
  account: ACCOUNT,
  history: [],
  modeState: { balance: { quoteAsset: 100 }, positions: [] },
} as never;

const TIMELINE: BlackSwanTimeline = {
  enabled: true,
  endTime: 2000,
  segments: [
    { enabled: true, status: "NORMAL", t: 1000 },
    { enabled: true, status: "CRISIS", t: 1500 },
  ],
  startTime: 1000,
};

describe("dashboard Black Swan timeline projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountLoad.mockResolvedValue({
      balance: { quoteAsset: 100 },
      positions: [],
    });
    mocks.historyReadAll.mockResolvedValue([]);
  });

  it("projects a cloned persisted timeline for the selected mode", () => {
    const status = { blackSwanTimeline: TIMELINE } as never;
    const state = systemDashboard.state.build({
      account: ACCOUNT,
      config: CONFIG,
      mode: "sandbox",
      source: SOURCE,
      status,
    });

    expect(state.blackSwanTimeline).toEqual(TIMELINE);
    expect(state.blackSwanTimeline).not.toBe(TIMELINE);
    expect(state.blackSwanTimeline?.segments).not.toBe(TIMELINE.segments);
  });

  it("leaves the timeline undefined for a persisted status without history", () => {
    const state = systemDashboard.state.build({
      account: ACCOUNT,
      config: CONFIG,
      mode: "sandbox",
      source: SOURCE,
      status: {} as never,
    });

    expect(state.blackSwanTimeline).toBeUndefined();
  });

  it("carries the persisted timeline through the combined snapshot", async () => {
    mocks.catalogEnsure.mockResolvedValue({
      config: CONFIG,
      mode: "sandbox",
    });
    mocks.statusLoad.mockResolvedValue({ blackSwanTimeline: TIMELINE });

    const combined = await systemDashboard.state.buildCombined({
      mode: "sandbox",
      refreshLiveBalance: false,
    });

    expect(mocks.statusLoad).toHaveBeenCalledWith("sandbox");
    expect(combined.blackSwanTimeline).toEqual(TIMELINE);
  });
});
