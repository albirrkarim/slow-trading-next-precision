import { describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "@/lib/precision/types";
import entryDiagnostics from "@/lib/system/trading/entry-diagnostics";

function balance() {
  return {
    available: 100,
    locked: 0,
    reserved: 0,
    safeHaven: 0,
    spendable: 100,
    startingBalance: 100,
    total: 100,
  };
}

function makeContext(
  overrides: {
    blackSwanProtective?: boolean;
    blackSwanStatus?: unknown;
  } = {},
): RuntimeContext {
  return {
    adapter: { exchange: { getFeeRate: () => 0 } },
    helper: {
      getAccountBalance: balance,
      getAccountConfig: () => ({}),
      market: { updateMarkPrice: vi.fn(async () => undefined) },
    },
    state: {
      balance: { "acc-1": balance() },
      blackSwanProtective: overrides.blackSwanProtective,
      blackSwanStatus: overrides.blackSwanStatus,
      config: {
        accounts: [
          { enabled: true, name: "Main", slug: "acc-1", trading: {} },
        ],
        management: {
          exchangeType: "binance",
          symbols: ["SUI"],
          tradingMode: "spot",
        },
        runtime: { autoEntryEnabled: true, runnerEnabled: true },
      },
      markPriceMap: {},
      openPositions: [],
      vPointsMap: {},
    },
  } as unknown as RuntimeContext;
}

describe("entry diagnostics Black Swan state", () => {
  it("reports the engine's full status and reason without the legacy flag", async () => {
    const context = makeContext({
      blackSwanStatus: {
        reason: "BTC_HARD_TRIGGER",
        since: 1,
        status: "CRISIS",
        t: 2,
      },
    });
    const snapshot = await entryDiagnostics.build(context);

    const diagnostic = snapshot.accounts[0]?.diagnostics[0];
    expect(diagnostic?.code).toBe("BLACK_SWAN_PROTECTION");
    expect(diagnostic?.reason).toContain("CRISIS");
    expect(diagnostic?.reason).toContain("BTC_HARD_TRIGGER");
  });

  it("keeps the legacy boolean fallback and the explicit override", async () => {
    const legacy = await entryDiagnostics.build(
      makeContext({ blackSwanProtective: true }),
    );
    expect(legacy.accounts[0]?.diagnostics[0]?.reason).toBe(
      "Blocked because Black Swan protection is active.",
    );

    const overridden = await entryDiagnostics.build(
      makeContext({
        blackSwanProtective: true,
        blackSwanStatus: {
          reason: "BTC_HARD_TRIGGER",
          since: 1,
          status: "CRISIS",
          t: 2,
        },
      }),
      {
        blackSwan: {
          reason: "HEALTHY",
          since: 1,
          status: "NORMAL",
          t: 2,
        },
      },
    );
    expect(
      overridden.accounts[0]?.diagnostics.some(
        (diagnostic) => diagnostic.code === "BLACK_SWAN_PROTECTION",
      ),
    ).toBe(false);
  });

  it("a NORMAL full status overrides a stale protective boolean", async () => {
    const snapshot = await entryDiagnostics.build(
      makeContext({
        blackSwanProtective: true,
        blackSwanStatus: {
          reason: "HEALTHY",
          since: 1,
          status: "NORMAL",
          t: 2,
        },
      }),
    );
    expect(
      snapshot.accounts[0]?.diagnostics.some(
        (diagnostic) => diagnostic.code === "BLACK_SWAN_PROTECTION",
      ),
    ).toBe(false);
  });
});
