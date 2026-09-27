import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeContext,
  RuntimeEngineState,
  RuntimeEntryDecision,
  RuntimePairEntryDecision,
} from "@/lib/precision/types";
import type {
  Position,
  RuntimeHistoryPosition,
} from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

import pairAction from "@/lib/system/trading/pair-action";
import entryDiagnostics from "@/lib/system/trading/entry-diagnostics";
import entryMonitoring from "@/lib/precision/monitoring/entry";
import strategies from "@/lib/strategies";
import pair from "@/lib/strategies/shared/pair";
import pairBoard from "@/lib/strategies/shared/board";
import pairDiagnostics from "@/lib/strategies/shared/diagnostics";
import pairGuard from "@/lib/strategies/shared/guard";
import bothExit from "@/lib/strategies/both/exit";
import both from "@/lib/strategies/both";
import bothState from "@/lib/strategies/both/state";
import streak from "@/lib/strategies/streak";
import streakEntry from "@/lib/strategies/streak/entry";
import streakExit from "@/lib/strategies/streak/exit";
import streakState from "@/lib/strategies/streak/state";

const NOW = Date.UTC(2026, 5, 18, 12);

function point(overrides: Partial<VolatilityPoint>): VolatilityPoint {
  return {
    id: "P",
    l: "T",
    lvl: 1,
    p: 1,
    pct: 3,
    t: NOW - 60_000,
    vb: 1,
    vq: 1,
    ...overrides,
  } as VolatilityPoint;
}

function leg(overrides: Partial<Position> = {}): Position {
  return {
    account: "acc",
    closed: undefined,
    direction: "LONG",
    exposure: {
      averageEntryPrice: 1,
      leverage: 1,
      marginUsdt: 10,
      notionalUsdt: 10,
      quantity: 10,
    },
    fees: { entryUsdt: 0.1 },
    opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
    pnl: {},
    strategy: {
      averaging: {
        entryLevel: 0,
        lastHandledLevel: 0,
        reserveBaseMarginUsdt: 0,
        reservedRemainingMarginUsdt: 0,
        steps: [],
      },
      entry: { label: "test" },
    },
    symbol: "SUI",
    ...overrides,
  } as Position;
}

function pairedLeg(
  pairId: string,
  role: "MAIN" | "COUNTER",
  overrides: Partial<Position> = {},
): Position {
  return leg({
    ...overrides,
    strategy: {
      averaging: {
        entryLevel: 0,
        lastHandledLevel: 0,
        reserveBaseMarginUsdt: 0,
        reservedRemainingMarginUsdt: 0,
        steps: [],
      },
      entry: { label: "test" },
      logic: { entryLegs: "BOTH", pairId, role },
    },
  } as Position);
}

function makeState(
  overrides: Partial<RuntimeEngineState> = {},
): RuntimeEngineState {
  return {
    balance: {
      acc: {
        available: 1_000,
        locked: 0,
        reserved: 0,
        safeHaven: 0,
        spendable: 1_000,
        total: 1_000,
      },
    },
    config: {
      accounts: [
        { enabled: true, slug: "acc", trading: {} },
      ],
      management: {
        exchangeType: "binance",
        openDirection: "BOTH",
        symbols: ["SUI"],
        tradingMode: "futures",
      },
      runtime: {
        autoEntryEnabled: true,
        autoExitEnabled: true,
        runnerEnabled: true,
      },
    },
    currentTime: NOW,
    markPriceMap: { SUI: { lastUpdated: NOW, price: 1 } },
    mode: "backtest",
    openPositions: [],
    vPointsMap: {},
    ...overrides,
  } as unknown as RuntimeEngineState;
}

function makeContext(
  state: RuntimeEngineState,
  adapter: Record<string, unknown> = {},
): RuntimeContext {
  return {
    adapter: {
      exchange: {
        getFeeRate: () => 0.001,
        getRoundTripFeeRate: () => 0.002,
      },
      onNotif: () => false,
      ...adapter,
    },
    helper: {
      getAccount: (slug: string) =>
        state.config.accounts.find((account) => account.slug === slug)!,
      getAccountBalance: (slug: string) => state.balance[slug],
      getAccountConfig: (slug: string) =>
        state.config.accounts.find((account) => account.slug === slug)
          ?.trading ?? {},
      market: {
        updateMarkPrice: vi.fn(async () => undefined),
        updateVPointsMap: vi.fn(async () => undefined),
      },
    },
    state,
  } as unknown as RuntimeContext;
}

function entryDecision(overrides: Record<string, unknown> = {}) {
  return {
    accountSlug: "acc",
    direction: "LONG",
    entrySignal: point({ id: "A" }),
    message: "signal",
    symbol: "SUI",
    type: "entry",
    ...overrides,
  } as RuntimeEntryDecision;
}

function pairDecision(
  pairId = "acc:SUI:A",
  legs?: RuntimeEntryDecision[],
): RuntimePairEntryDecision {
  return {
    type: "pairEntry",
    accountSlug: "acc",
    legs:
      legs ??
      ([
        {
          ...entryDecision({ direction: "LONG" }),
          strategy: { entryLegs: "BOTH", pairId, role: "MAIN" },
        },
        {
          ...entryDecision({ direction: "SHORT" }),
          strategy: { entryLegs: "BOTH", pairId, role: "COUNTER" },
        },
      ] as RuntimeEntryDecision[]),
    message: "pair",
    strategy: { entryLegs: "BOTH", pairId },
    symbol: "SUI",
  };
}

describe("pairAction.execute — atomic pair executor", () => {
  it("returns leg-order positions when every leg fills", async () => {
    const state = makeState();
    const context = makeContext(state);
    const decision = pairDecision();
    const fills = decision.legs.map((_, index) =>
      leg({ direction: index === 0 ? "LONG" : "SHORT" }),
    );

    const result = await pairAction.execute({
      context,
      decision,
      executeLeg: (pairLeg) => fills[decision.legs.indexOf(pairLeg)],
    });

    expect(result).toEqual(fills);
  });

  it("rolls back earlier fills when a later leg fails", async () => {
    const context = makeContext(makeState());
    const decision = pairDecision();
    const rolledBack: Position[] = [];

    const result = await pairAction.execute({
      context,
      decision,
      executeLeg: (pairLeg) =>
        pairLeg.direction === "LONG"
          ? leg({ direction: "LONG" })
          : null,
      rollbackLeg: (_leg, position) => {
        rolledBack.push(position);
      },
    });

    expect(result).toBeNull();
    expect(rolledBack).toHaveLength(1);
    expect(rolledBack[0].direction).toBe("LONG");
  });

  it("unwinds filled legs and rethrows when a leg throws", async () => {
    const context = makeContext(makeState());
    const decision = pairDecision();
    const legOnePosition = leg({ direction: "LONG" });
    const rollbackLeg = vi.fn();

    await expect(
      pairAction.execute({
        context,
        decision,
        executeLeg: (pairLeg) => {
          if (pairLeg.direction === "LONG") return legOnePosition;
          throw new Error("boom");
        },
        rollbackLeg,
      }),
    ).rejects.toThrow("boom");

    expect(rollbackLeg).toHaveBeenCalledOnce();
    expect(rollbackLeg).toHaveBeenCalledWith(
      decision.legs[0],
      legOnePosition,
      context,
    );
  });

  it("returns null without rollback calls when the first leg fails", async () => {
    const context = makeContext(makeState());
    const rollback = vi.fn();

    const result = await pairAction.execute({
      context,
      decision: pairDecision(),
      executeLeg: () => null,
      rollbackLeg: rollback,
    });

    expect(result).toBeNull();
    expect(rollback).not.toHaveBeenCalled();
  });
});

describe("pair meta — strategy payload validation", () => {
  it("reads pair identity from position.strategy.logic", () => {
    const position = pairedLeg("pair-1", "COUNTER");
    expect(pair.meta.ofPosition(position)).toEqual({
      entryLegs: "BOTH",
      pairId: "pair-1",
      role: "COUNTER",
    });
  });

  it("rejects foreign or malformed payloads", () => {
    expect(pair.meta.ofPosition(leg())).toBeUndefined();
    expect(
      pair.meta.ofPosition(
        leg({ strategy: {
          averaging: {
            entryLevel: 0,
            lastHandledLevel: 0,
            reserveBaseMarginUsdt: 0,
            reservedRemainingMarginUsdt: 0,
            steps: [],
          },
          entry: {},
          logic: { role: "X" },
        } }),
      ),
    ).toBeUndefined();
    expect(pair.meta.ofDecision(pairDecision())).toBeUndefined();
  });

  it("finds the open sibling leg by pair id and opposite role", () => {
    const state = makeState({
      openPositions: [
        pairedLeg("p1", "MAIN"),
        pairedLeg("p1", "COUNTER"),
        pairedLeg("p2", "MAIN"),
      ],
    });
    const context = makeContext(state);
    const meta = pair.meta.ofPosition(state.openPositions[0])!;
    expect(pair.findSibling(context, meta)).toBe(state.openPositions[1]);
    // A closed sibling does not count.
    (state.openPositions[1] as { closed?: unknown }).closed = { t: 1 };
    expect(pair.findSibling(context, meta)).toBeUndefined();
  });
});

describe("pairGuard.allows — pair-aware capacity", () => {
  it("counts one pair as one worker against maxOpenPositions", () => {
    const state = makeState({
      openPositions: [
        pairedLeg("p1", "MAIN"),
        pairedLeg("p1", "COUNTER"),
      ],
    });
    const account = state.config.accounts[0];
    account.trading.maxOpenPositions = 2;
    const context = makeContext(state);
    // A second pair on another configured symbol passes — the open pair is
    // one worker, not two.
    state.config.management.symbols = ["SUI", "DOGE"];
    expect(
      pairGuard.allows(
        { ...pairDecision("acc:DOGE:B"), symbol: "DOGE" },
        context,
      ),
    ).toBe(true);
    // With the budget fully consumed the same pair is vetoed.
    account.trading.maxOpenPositions = 1;
    expect(
      pairGuard.allows(
        { ...pairDecision("acc:DOGE:B"), symbol: "DOGE" },
        context,
      ),
    ).toBe(false);
  });

  it("vetoes a pair on a symbol with any open position", () => {
    const state = makeState({
      openPositions: [pairedLeg("p1", "MAIN")],
    });
    expect(
      pairGuard.allows(pairDecision(), makeContext(state)),
    ).toBe(false);
  });

  it("lets a role re-entry fill the pair's empty slot without a new worker", () => {
    const state = makeState({
      openPositions: [pairedLeg("p1", "MAIN")],
    });
    const account = state.config.accounts[0];
    account.trading.maxOpenPositions = 1;
    const context = makeContext(state);
    const reopen = entryDecision({
      strategy: { entryLegs: "BOTH", pairId: "p1", reopen: true, role: "COUNTER" },
    });
    expect(pairGuard.allows(reopen, context)).toBe(true);
    // The already-filled role is vetoed.
    const duplicate = entryDecision({
      strategy: { entryLegs: "BOTH", pairId: "p1", role: "MAIN" },
    });
    expect(pairGuard.allows(duplicate, context)).toBe(false);
  });

  it("keeps shared protections: runner toggle, black swan, exit gate", () => {
    const state = makeState();
    state.config.runtime.runnerEnabled = false;
    const context = makeContext(state);
    expect(pairGuard.allows(pairDecision(), context)).toBe(false);
    expect(
      pairGuard.allows(
        {
          accountSlug: "acc",
          position: { control: {} },
          symbol: "SUI",
          tradeDecision: {},
          type: "exit",
        } as never,
        context,
      ),
    ).toBe(false); // autoExit is on but runner off — common vetoes non-manual
  });
});

describe("strategies.resolve — slug to module", () => {
  it("resolves configured slugs and passes through absent ones", async () => {
    expect((await strategies.resolve("both"))?.name).toBe("both");
    expect((await strategies.resolve("streak"))?.name).toBe("streak");
    expect(await strategies.resolve(undefined)).toBeUndefined();
    await expect(strategies.resolve("bogus")).rejects.toThrow(
      /Unknown strategy slug/,
    );
  });
});

describe("entryMonitoring.executeDecision — pair dispatch", () => {
  it("routes pairEntry to onPairAction and commits every leg", async () => {
    const state = makeState();
    const fills = [pairedLeg("acc:SUI:A", "MAIN"), pairedLeg("acc:SUI:A", "COUNTER")];
    const onPairAction = vi.fn(async () => fills);
    const onAction = vi.fn(async () => null);
    const context = makeContext(state, { onAction, onPairAction });

    const committed = await entryMonitoring.executeDecision(
      context,
      pairDecision(),
    );

    expect(onPairAction).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    expect(committed).toHaveLength(2);
    expect(state.openPositions).toHaveLength(2);
    // The decision→position hop: leg meta lands on position.strategy.logic.
    expect(pair.meta.ofPosition(state.openPositions[0])?.role).toBe("MAIN");
    expect(pair.meta.ofPosition(state.openPositions[1])?.role).toBe(
      "COUNTER",
    );
    // Balances updated per leg.
    expect(state.balance.acc.locked).toBe(20);
  });

  it("rejects a pair when the adapter has no onPairAction", async () => {
    const state = makeState();
    const context = makeContext(state, {
      onAction: vi.fn(async () => null),
    });
    const committed = await entryMonitoring.executeDecision(
      context,
      pairDecision(),
    );
    expect(committed).toBeNull();
    expect(state.openPositions).toHaveLength(0);
  });

  it("throws when the adapter returns fewer positions than legs", async () => {
    const state = makeState();
    const context = makeContext(state, {
      onPairAction: vi.fn(async () => [pairedLeg("acc:SUI:A", "MAIN")]),
    });
    await expect(
      entryMonitoring.executeDecision(context, pairDecision()),
    ).rejects.toThrow(/must either fill every leg/);
  });
});

describe("both exit — armed volatility target + pendingClose cascade", () => {
  function exitContext(overrides: Partial<RuntimeEngineState> = {}) {
    return makeContext(makeState(overrides));
  }

  it("emits VOLATILITY_TARGET_EXIT at the first level-0 after a non-zero entry", async () => {
    const position = pairedLeg("p1", "MAIN", {
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
    });
    const context = exitContext({
      vPointsMap: {
        SUI: [
          point({ id: "A", l: "T", lvl: 1, t: 90 }),
          point({ id: "B", l: "T", lvl: 2, t: 150 }),
          point({ id: "C", l: "B", lvl: 0, t: 200 }),
        ],
      },
    });

    const decision = await bothExit.find(context, position);
    expect(decision?.tradeDecision.position?.closed?.reason).toBe(
      "VOLATILITY_TARGET_EXIT",
    );
  });

  it("arms a level-0 entry only after the first non-zero level", async () => {
    const position = pairedLeg("p1", "MAIN", {
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 0 },
      },
    });
    // No non-zero point yet → not armed → no target exit.
    let context = exitContext({
      vPointsMap: {
        SUI: [point({ id: "A", l: "B", lvl: 0, t: 90 })],
      },
    });
    const first = await bothExit.find(context, position);
    expect(first?.tradeDecision.position?.closed?.reason).not.toBe(
      "VOLATILITY_TARGET_EXIT",
    );

    // Armed by B[1]; the next level-0 is the target.
    context = exitContext({
      vPointsMap: {
        SUI: [
          point({ id: "A", l: "B", lvl: 0, t: 90 }),
          point({ id: "B", l: "T", lvl: 1, t: 150 }),
          point({ id: "C", l: "B", lvl: 0, t: 200 }),
        ],
      },
    });
    const second = await bothExit.find(context, position);
    expect(second?.tradeDecision.position?.closed?.reason).toBe(
      "VOLATILITY_TARGET_EXIT",
    );
  });

  it("force-closes the surviving leg with the originating stop-loss reason", async () => {
    const sibling = pairedLeg("p1", "COUNTER", { direction: "SHORT" });
    const position = pairedLeg("p1", "MAIN");
    const context = exitContext({
      openPositions: [position, sibling],
      strategy: {
        v: "both",
        pendingClose: {
          p1: { message: "main leg stop loss", reason: "STOP_LOSS" },
        },
      },
    });

    const decision = await bothExit.find(context, position);
    expect(decision?.type).toBe("exit");
    expect(decision?.tradeDecision.action).toBe("SELL");
    // BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS — keeps the originating reason.
    expect(decision?.tradeDecision.position?.closed?.reason).toBe(
      "STOP_LOSS",
    );
  });

  it("disables TP%/SL+ on counter legs while MAIN is open, re-enables after", async () => {
    const counter = pairedLeg("p1", "COUNTER", {
      direction: "SHORT",
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
      pnl: { maxUpPct: 5 },
    });
    const main = pairedLeg("p1", "MAIN", { direction: "LONG" });

    // Armed-target avoided (no level-0 point); B[-1] gives the SHORT its
    // profit-side level pass — but only counts once MAIN is gone.
    const points = [
      point({ id: "A", l: "T", lvl: 1, t: 90 }),
      point({ id: "B", l: "B", lvl: -1, t: 150 }),
    ];
    const base: Partial<RuntimeEngineState> = {
      markPriceMap: { SUI: { lastUpdated: NOW, price: 0.965 } },
      openPositions: [counter, main],
      vPointsMap: { SUI: points },
    };

    const config = {
      accounts: [
        {
          enabled: true,
          slug: "acc",
          trading: { takeProfitPercent: 1 },
        },
      ],
      management: {
        exchangeType: "binance",
        openDirection: "BOTH",
        symbols: ["SUI"],
        tradingMode: "futures",
      },
      runtime: {
        autoEntryEnabled: true,
        autoExitEnabled: true,
        runnerEnabled: true,
      },
    } as never;

    // MAIN still open → SL+ stays disabled; a structural rule fires instead.
    const withMain = exitContext({ ...base, config });
    const decisionA = await bothExit.find(withMain, counter);
    expect(
      decisionA?.tradeDecision.position?.closed?.reason,
    ).not.toBe("STOP_LOSS_PLUS_TP");

    // MAIN gone + profit level passed → full rule set → SL+ fires.
    const withoutMain = exitContext({
      ...base,
      config,
      openPositions: [counter],
    });
    const decisionB = await bothExit.find(withoutMain, counter);
    expect(decisionB?.tradeDecision.position?.closed?.reason).toBe(
      "STOP_LOSS_PLUS_TP",
    );
  });

  it("counts only levels toward the profit side — a loss-side BOTTOM keeps the counter gated", async () => {
    // SHORT COUNTER entered at lvl 0, MAIN sibling already gone. A later
    // BOTTOM at lvl +1 moved toward the LOSS side for a short, so the
    // re-enable condition must not fire; a BOTTOM at lvl -1 did move
    // toward profit and re-enables TP%/SL+.
    const counter = pairedLeg("p1", "COUNTER", {
      direction: "SHORT",
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 0 },
      },
      pnl: { maxUpPct: 5 },
    });
    const config = {
      accounts: [
        {
          enabled: true,
          slug: "acc",
          trading: { takeProfitPercent: 1 },
        },
      ],
      management: {
        exchangeType: "binance",
        openDirection: "BOTH",
        symbols: ["SUI"],
        tradingMode: "futures",
      },
      runtime: {
        autoEntryEnabled: true,
        autoExitEnabled: true,
        runnerEnabled: true,
      },
    } as never;
    const base: Partial<RuntimeEngineState> = {
      config,
      markPriceMap: { SUI: { lastUpdated: NOW, price: 0.965 } },
      openPositions: [counter],
    };

    // B[+1] is a loss-side move for a short → still gated.
    const lossSide = exitContext({
      ...base,
      vPointsMap: {
        SUI: [
          point({ id: "A", l: "T", lvl: 0, t: 90 }),
          point({ id: "B", l: "B", lvl: 1, t: 150 }),
        ],
      },
    });
    const gated = await bothExit.find(lossSide, counter);
    expect(gated?.tradeDecision.position?.closed?.reason).not.toBe(
      "STOP_LOSS_PLUS_TP",
    );

    // B[-1] is a profit-side move → full rule set → SL+ fires.
    const profitSide = exitContext({
      ...base,
      vPointsMap: {
        SUI: [
          point({ id: "A", l: "T", lvl: 0, t: 90 }),
          point({ id: "B", l: "B", lvl: -1, t: 150 }),
        ],
      },
    });
    const reenabled = await bothExit.find(profitSide, counter);
    expect(reenabled?.tradeDecision.position?.closed?.reason).toBe(
      "STOP_LOSS_PLUS_TP",
    );
  });
});

describe("both onActionResult — pendingClose bookkeeping", () => {
  it("flags the sibling for a cascading close on a stop-loss exit", async () => {
    const closedMain = pairedLeg("p1", "MAIN", {
      closed: {
        message: "hard stop",
        price: 0.9,
        reason: "STOP_LOSS",
        t: NOW,
      } as never,
    });
    const sibling = pairedLeg("p1", "COUNTER", { direction: "SHORT" });
    const state = makeState({ openPositions: [sibling] });
    const context = makeContext(state);

    await both.onActionResult?.(
      "success",
      {
        accountSlug: "acc",
        position: closedMain,
        symbol: "SUI",
        tradeDecision: {},
        type: "exit",
      } as never,
      closedMain,
      context,
    );

    const slot = state.strategy as {
      pendingClose: Record<string, { reason: string }>;
    };
    expect(slot.pendingClose.p1?.reason).toBe("STOP_LOSS");
  });

  it("clears the flag once no open leg of the pair remains", async () => {
    const closedCounter = pairedLeg("p1", "COUNTER", {
      direction: "SHORT",
      closed: {
        message: "cascade",
        price: 1,
        reason: "STOP_LOSS",
        t: NOW,
      } as never,
    });
    const state = makeState({
      openPositions: [],
      strategy: {
        v: "both",
        pendingClose: {
          p1: { message: "x", reason: "STOP_LOSS" },
        },
      },
    });
    const context = makeContext(state);

    await both.onActionResult?.(
      "success",
      {
        accountSlug: "acc",
        position: closedCounter,
        symbol: "SUI",
        tradeDecision: {},
        type: "exit",
      } as never,
      closedCounter,
      context,
    );

    const slot = state.strategy as {
      pendingClose: Record<string, unknown>;
    };
    expect(slot.pendingClose.p1).toBeUndefined();
  });
});

describe("streak entry — role re-entry producer", () => {
  function streakStateWith(record: Record<string, unknown>) {
    return { roles: record, v: "streak" };
  }

  it("reopens the empty role opposite the surviving leg at the newest unused vPoint", async () => {
    const sibling = pairedLeg("acc:SUI:A", "COUNTER", {
      direction: "SHORT",
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
    });
    const anchor = point({ id: "B", l: "T", lvl: 2, t: 150 });
    const state = makeState({
      openPositions: [sibling],
      strategy: streakStateWith({
        "acc:SUI:A": {
          accountSlug: "acc",
          pairId: "acc:SUI:A",
          role: "MAIN",
          symbol: "SUI",
        },
      }),
      vPointsMap: {
        // "acc" markers suppress a fresh-pair signal on these points while
        // the role-scoped reopen anchor stays free.
        SUI: [
          point({ id: "A", l: "T", lvl: 1, t: 90, usedBy: ["acc"] }),
          { ...anchor, usedBy: ["acc"] },
        ] as never[],
      },
    });
    const context = makeContext(state);

    const candidates = await streakEntry.find(context);
    const reopen = candidates.find((c) => c.type === "entry");
    expect(reopen).toBeDefined();
    expect(reopen?.type === "entry" && reopen.direction).toBe("LONG");
    const meta = pair.meta.ofDecision(reopen!);
    expect(meta).toEqual({
      entryLegs: "BOTH",
      pairId: "acc:SUI:A",
      reopen: true,
      role: "MAIN",
    });
    expect(
      reopen?.type === "entry" && reopen.vPointUsage,
    ).toEqual(["acc:MAIN"]);
  });

  it("drops the role record when the surviving sibling is gone", async () => {
    const state = makeState({
      openPositions: [],
      strategy: streakStateWith({
        "acc:SUI:A": {
          accountSlug: "acc",
          pairId: "acc:SUI:A",
          role: "MAIN",
          symbol: "SUI",
        },
      }),
    });
    const context = makeContext(state);
    await streakEntry.find(context);
    expect(
      (state.strategy as { roles: Record<string, unknown> }).roles,
    ).toEqual({});
  });

  it("records the blocking reason when every anchor is already used", async () => {
    const sibling = pairedLeg("acc:SUI:A", "COUNTER", {
      direction: "SHORT",
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
    });
    const state = makeState({
      openPositions: [sibling],
      strategy: streakStateWith({
        "acc:SUI:A": {
          accountSlug: "acc",
          pairId: "acc:SUI:A",
          role: "MAIN",
          symbol: "SUI",
        },
      }),
      vPointsMap: {
        SUI: [
          point({ id: "A", l: "T", lvl: 1, t: 90, usedBy: ["acc:MAIN"] }),
        ] as never[],
      },
    });
    const context = makeContext(state);
    const candidates = await streakEntry.find(context);
    expect(
      candidates.filter((c) => c.type === "entry"),
    ).toHaveLength(0);
    const record = (
      state.strategy as {
        roles: Record<string, { reason?: string }>;
      }
    ).roles["acc:SUI:A"];
    expect(record.reason).toContain("waiting");
  });
});

describe("streak exit — entry vPoint cannot be its own target", () => {
  it("ignores the anchor the leg opened on, closes on a later TOP", async () => {
    // The leg opened ON this TOP (opened.t === anchor.t and the same
    // vPoint id); it must not close on its own anchor.
    const anchor = point({ id: "A", l: "T", lvl: 1, t: 100 });
    const position = pairedLeg("p1", "MAIN", {
      opened: {
        message: "entry",
        price: 1,
        reason: "COMMON",
        t: 100,
        vPoint: { id: "A", lvl: 1 },
      },
    });

    let context = makeContext(
      makeState({ vPointsMap: { SUI: [anchor] } }),
    );
    const own = await streakExit.find(context, position);
    expect(own?.tradeDecision.position?.closed?.reason).not.toBe(
      "VOLATILITY_TARGET_EXIT",
    );

    context = makeContext(
      makeState({
        vPointsMap: {
          SUI: [anchor, point({ id: "B", l: "T", lvl: 2, t: 150 })],
        },
      }),
    );
    const later = await streakExit.find(context, position);
    expect(later?.tradeDecision.position?.closed?.reason).toBe(
      "VOLATILITY_TARGET_EXIT",
    );
  });
});

function exitDecisionStub() {
  return {
    accountSlug: "acc",
    position: null,
    symbol: "SUI",
    tradeDecision: {},
    type: "exit",
  } as never;
}

describe("both state — closed-leg snapshot + peek", () => {
  it("stores a slim snapshot of the closed leg while the sibling survives", async () => {
    const closedMain = pairedLeg("p1", "MAIN", {
      closed: {
        message: "take profit",
        price: 1.1,
        reason: "TAKE_PROFIT_PERCENT",
        t: NOW,
      } as never,
      pnl: { netPct: 10, netUsdt: 2.5 } as never,
    });
    const sibling = pairedLeg("p1", "COUNTER", { direction: "SHORT" });
    const state = makeState({ openPositions: [sibling] });
    const context = makeContext(state);

    await both.onActionResult?.(
      "success",
      exitDecisionStub(),
      closedMain,
      context,
    );

    const slot = state.strategy as {
      closed: Record<
        string,
        { direction: string; pnl: { usdt: number }; role: string }
      >;
      pendingClose: Record<string, unknown>;
    };
    expect(slot.closed.p1?.role).toBe("MAIN");
    expect(slot.closed.p1?.direction).toBe("LONG");
    expect(slot.closed.p1?.pnl.usdt).toBe(2.5);
    // Non-cascade reason → no pendingClose flag.
    expect(slot.pendingClose.p1).toBeUndefined();
  });

  it("clears the snapshot and pendingClose once the pair fully closes", async () => {
    const closedCounter = pairedLeg("p1", "COUNTER", {
      closed: { price: 1, reason: "STOP_LOSS", t: NOW } as never,
      direction: "SHORT",
    });
    const state = makeState({
      openPositions: [],
      strategy: {
        closed: {
          p1: { role: "MAIN" },
        },
        pendingClose: {
          p1: { message: "x", reason: "STOP_LOSS" },
        },
        v: "both",
      },
    });
    const context = makeContext(state);

    await both.onActionResult?.(
      "success",
      exitDecisionStub(),
      closedCounter,
      context,
    );

    const slot = state.strategy as {
      closed: Record<string, unknown>;
      pendingClose: Record<string, unknown>;
    };
    expect(slot.closed.p1).toBeUndefined();
    expect(slot.pendingClose.p1).toBeUndefined();
  });

  it("normalizes a persisted slot written before `closed` existed", () => {
    const state = makeState({
      strategy: { v: "both" },
    });
    const read = bothState.read(makeContext(state));
    expect(read.closed).toEqual({});
    expect(read.pendingClose).toEqual({});
  });

  it("peek reads the matching slot without ever writing state.strategy", () => {
    const state = makeState();
    const context = makeContext(state);

    expect(bothState.peek(context).closed).toEqual({});
    expect(state.strategy).toBeUndefined();

    state.strategy = { closed: { p1: { role: "MAIN" } }, v: "both" };
    expect(bothState.peek(context).closed.p1).toBeDefined();

    state.strategy = { roles: {}, v: "streak" };
    expect(bothState.peek(context).closed).toEqual({});
    expect(streakState.peek(context).roles).toEqual({});
  });
});

describe("streak — empty-role block reasons", () => {
  function streakContext() {
    const state = makeState({
      openPositions: [
        pairedLeg("acc:SUI:A", "COUNTER", { direction: "SHORT" }),
      ],
      strategy: {
        roles: {
          "acc:SUI:A": {
            accountSlug: "acc",
            pairId: "acc:SUI:A",
            role: "MAIN",
            symbol: "SUI",
          },
        },
        v: "streak",
      },
    });
    return { context: makeContext(state), state };
  }

  function reopenDecision() {
    return entryDecision({
      strategy: {
        entryLegs: "BOTH",
        pairId: "acc:SUI:A",
        reopen: true,
        role: "MAIN",
      },
    });
  }

  it("records the guard-veto reason when a re-entry is blocked", () => {
    const { context, state } = streakContext();
    state.config.runtime.runnerEnabled = false;

    expect(streak.guard?.allows(reopenDecision(), context)).toBe(false);
    const record = (
      state.strategy as { roles: Record<string, { reason?: string }> }
    ).roles["acc:SUI:A"];
    expect(record.reason).toContain("Re-entry blocked by the entry guard");
  });

  it("records a retry reason when the re-entry order fails", async () => {
    const { context, state } = streakContext();

    await streak.onActionResult?.("failed", reopenDecision(), null, context);

    const record = (
      state.strategy as { roles: Record<string, { reason?: string }> }
    ).roles["acc:SUI:A"];
    expect(record.reason).toBe(
      "Re-entry order failed; retrying on the next pass.",
    );
  });
});

describe("pair diagnostics — view + explain", () => {
  it("returns undefined when openDirection is not BOTH", () => {
    const state = makeState();
    state.config.management.openDirection = "ONE_WAY";
    expect(
      pairDiagnostics.explain({
        accountSlug: "acc",
        context: makeContext(state),
        symbol: "SUI",
      }),
    ).toBeUndefined();
  });

  it("explains PAIR_OPEN while both legs are open", () => {
    const state = makeState({
      openPositions: [
        pairedLeg("acc:SUI:A", "MAIN"),
        pairedLeg("acc:SUI:A", "COUNTER", { direction: "SHORT" }),
      ],
    });
    const result = pairDiagnostics.explain({
      accountSlug: "acc",
      context: makeContext(state),
      symbol: "SUI",
    });
    expect(result).toEqual({
      code: "PAIR_OPEN",
      reason: "MAIN and COUNTER legs are open.",
      status: "blocked",
    });
  });

  it("explains PAIR_ROLE_EMPTY with the wait-for-sibling reason for both", () => {
    const state = makeState({
      openPositions: [pairedLeg("acc:SUI:A", "MAIN")],
    });
    const result = pairDiagnostics.explain({
      accountSlug: "acc",
      context: makeContext(state),
      symbol: "SUI",
    });
    expect(result?.code).toBe("PAIR_ROLE_EMPTY");
    expect(result?.reason).toBe(
      "COUNTER leg closed; a new pair opens after the MAIN leg closes.",
    );
  });

  it("surfaces the streak re-entry reason on the empty role", () => {
    const state = makeState({
      openPositions: [
        pairedLeg("acc:SUI:A", "COUNTER", { direction: "SHORT" }),
      ],
      strategy: {
        roles: {
          "acc:SUI:A": {
            pairId: "acc:SUI:A",
            reason: "no unused anchor",
            role: "MAIN",
          },
        },
        v: "streak",
      },
    });
    const result = streak.diagnostics?.explain?.({
      accountSlug: "acc",
      context: makeContext(state),
      symbol: "SUI",
    });
    expect(result?.code).toBe("PAIR_ROLE_EMPTY");
    expect(result?.reason).toBe("MAIN re-entry pending: no unused anchor");
  });

  it("explains PAIR_FUNDING_INSUFFICIENT when the pair cannot be funded", () => {
    const state = makeState();
    state.balance.acc.spendable = 0;
    const result = pairDiagnostics.explain({
      accountSlug: "acc",
      context: makeContext(state),
      decision: entryDecision(),
      symbol: "SUI",
    });
    expect(result?.code).toBe("PAIR_FUNDING_INSUFFICIENT");
  });

  it("counts one pair as one worker for MAX_OPEN_POSITIONS in build", async () => {
    const state = makeState({
      markPriceMap: {
        DOGE: { lastUpdated: NOW, price: 1 },
        SUI: { lastUpdated: NOW, price: 1 },
      },
      openPositions: [
        pairedLeg("acc:SUI:A", "MAIN"),
        pairedLeg("acc:SUI:A", "COUNTER", { direction: "SHORT" }),
      ],
      vPointsMap: {
        DOGE: [point({ id: "D", l: "T", lvl: 2, t: 150 })],
        SUI: [
          point({
            id: "A",
            l: "T",
            lvl: 1,
            t: 90,
            usedBy: ["acc:MAIN", "acc:COUNTER"],
          }),
        ],
      } as never,
    });
    state.config.accounts[0].trading.maxOpenPositions = 2;
    state.config.management.symbols = ["SUI", "DOGE"];

    // Default pipeline: the two legs count as two positions — capacity hit.
    const plain = await entryDiagnostics.build(makeContext(state));
    expect(
      plain.accounts[0].diagnostics.find((d) => d.symbol === "DOGE")?.code,
    ).toBe("MAX_OPEN_POSITIONS_REACHED");

    // Pair view: the pair collapses to one worker — DOGE keeps capacity.
    const context = makeContext(state);
    context.strategy = both;
    const paired = await entryDiagnostics.build(context);
    expect(
      paired.accounts[0].diagnostics.find((d) => d.symbol === "SUI")?.code,
    ).toBe("PAIR_OPEN");
    expect(
      paired.accounts[0].diagnostics.find((d) => d.symbol === "DOGE")?.code,
    ).not.toBe("MAX_OPEN_POSITIONS_REACHED");
  });
});

describe("pairBoard.build — paired board view model", () => {
  function boardPosition(
    pairId: string,
    role: "MAIN" | "COUNTER",
    overrides: Partial<Position> = {},
  ): RuntimeHistoryPosition {
    return {
      ...pairedLeg(pairId, role, overrides),
      mode: "live",
    } as RuntimeHistoryPosition;
  }

  const closedMain = {
    account: "acc",
    closed: { price: 0.9, reason: "STOP_LOSS", t: NOW },
    direction: "LONG",
    marginUsdt: 10,
    opened: { price: 1, t: 100 },
    pnl: { pct: -10, usdt: -5 },
    role: "MAIN",
    symbol: "SUI",
  } as const;

  it("shows the closed-leg snapshot and includes realized PnL", () => {
    const open = boardPosition("acc:SUI:A", "COUNTER", {
      direction: "SHORT",
      pnl: { netUsdt: 3 } as never,
    });
    const { rows, unpaired } = pairBoard.build({
      accounts: ["acc"],
      openPositions: [open],
      slug: "both",
      strategyState: { closed: { "acc:SUI:A": closedMain }, v: "both" },
      symbols: ["SUI"],
    });

    expect(unpaired).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].slots.COUNTER.kind).toBe("open");
    expect(rows[0].slots.MAIN).toEqual({ kind: "closed", leg: closedMain });
    expect(rows[0].netUsdt).toBe(-2);
  });

  it("explains a never-traded role from the leg's entryLegs selection", () => {
    const open = boardPosition("acc:SUI:A", "MAIN");
    (open.strategy as { logic?: unknown }).logic = {
      entryLegs: "MAIN",
      pairId: "acc:SUI:A",
      role: "MAIN",
    };
    const { rows } = pairBoard.build({
      accounts: ["acc"],
      openPositions: [open],
      slug: "both",
      strategyState: { v: "both" },
      symbols: ["SUI"],
    });
    expect(rows[0].slots.COUNTER).toEqual({
      kind: "empty",
      reason: "Not traded (entryLegs MAIN).",
    });
  });

  it("streak shows the pending re-entry reason and every configured coin", () => {
    const open = boardPosition("acc:SUI:A", "COUNTER", {
      direction: "SHORT",
    });
    const { rows } = pairBoard.build({
      accounts: ["acc"],
      openPositions: [open],
      slug: "streak",
      strategyState: {
        roles: { "acc:SUI:A": { reason: "anchor used", role: "MAIN" } },
        v: "streak",
      },
      symbols: ["DOGE", "SUI"],
    });

    const sui = rows.find((row) => row.symbol === "SUI");
    expect(sui?.slots.COUNTER.kind).toBe("open");
    expect(sui?.slots.MAIN).toEqual({
      kind: "empty",
      reason: "anchor used",
    });

    // Every configured coin gets a row even with no pair at all.
    const doge = rows.find((row) => row.symbol === "DOGE");
    expect(doge?.pairId).toBeUndefined();
    expect(doge?.slots.MAIN.kind).toBe("empty");
    expect(doge?.slots.COUNTER.kind).toBe("empty");

    // The account filter narrows the coin coverage.
    const { rows: filtered } = pairBoard.build({
      accounts: ["other"],
      openPositions: [open],
      slug: "streak",
      strategyState: undefined,
      symbols: ["SUI"],
    });
    const pairRow = filtered.find((row) => row.pairId);
    expect(pairRow?.account).toBe("acc");
    expect(
      filtered.filter((row) => !row.pairId).map((row) => row.account),
    ).toEqual(["other"]);
  });

  it("separates unpaired positions and tolerates a foreign slot", () => {
    const plain = { ...leg(), mode: "live" } as RuntimeHistoryPosition;
    const open = boardPosition("acc:SUI:A", "MAIN");
    const { rows, unpaired } = pairBoard.build({
      accounts: ["acc"],
      openPositions: [plain, open],
      slug: "both",
      strategyState: { roles: {}, v: "streak" },
      symbols: ["SUI"],
    });
    expect(unpaired).toEqual([plain]);
    expect(rows[0].slots.COUNTER).toEqual({ kind: "empty", reason: "Closed." });
  });
});
