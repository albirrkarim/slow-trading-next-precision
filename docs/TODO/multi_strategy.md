# Multi Strategy Assessment

# Introduction

Read the
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-precision/docs/PRECISION/_PRECISION.md

Is this project are capable of accomodating the strategy of

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge/docs/slow/HEDGE/BOTH_DIRECTION_TRADING.md

and this

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak

Is the data type and RuntimeEngine APIs can able to accomodate that instance strategy.

I plan of making the

lib/strategies/both
lib/strategies/streak

and this system can be used as foundation, to accomodate strategy that build on top of it.

---

# Status (updated 2026-09-27)

Yes — and the plug contract plus engine wiring have since **landed**. What
remains is the strategy modules themselves (`src/lib/strategies/` does not
exist yet) plus the pair-aware data-type and execution extensions.

## Landed

- **`StrategyAPI` contract** — `src/lib/strategy/type.d.ts`: `name`,
  `decisions.{entry,averaging,exit}.find`, `onActionResult`, `preflight`.
  `StrategySlug = "both" | "streak"` is already declared.
- **Engine wiring** — `RuntimeEngine(state, adapter, strategy?)`
  (`src/lib/precision/RuntimeEngine.ts`) carries `context.strategy` on every
  `RuntimeContext`; stages swap `defaultDecision.<family>` for
  `strategy.decisions.<family>` when present (entry in
  `monitoring/entry.ts`, averaging + exit in `monitoring/position.ts`),
  fire `strategy.onActionResult` after each `onAction` outcome — before the
  env `onStateChange`/`onExit` persistence — and run `strategy.preflight`
  during `start()`.
- **Strategy-owned state slot** — `RuntimeEngineState.strategy?: unknown`
  (`src/lib/precision/types.ts`). Carried into `PrecisionRuntimeSnapshot`
  (`src/lib/system/runtime/test-case.ts`) and written into captured test
  cases (`src/lib/production/precision-test-case/recorder.ts`), so
  precision-checker replays reproduce strategy records automatically.
- **Per-leg vPoint consumption** — `vPointUsage` on decisions +
  `VolatilityPoint.usedBy: string[]` markers (`"<slug>"` or
  `"<slug>:<ROLE>"` convention) are implemented.
- **Environment approval extension** — `adapter.onActionEnvGuard`
  (production wires it to the persisted-catalog `isActionAllowed` check in
  `factory.ts`) sits alongside the shared `guard.allows` on every
  decision, whatever its producer.
- **Strategy-owned entry payload** — `Position.strategy.entry.feature?:
  TFeature` is the generic strategy slot on the canonical position —
  supersedes the earlier `Position.strategy.logic` sketch.
- **Exchange layer supports `positionSide`** — hedge-mode order mechanics
  are mostly adapter-side work (`src/lib/exchange/`,
  `platform/binance/futures/position-mode.ts`).

## Still open

1. **`config.strategy` field + slug→module resolution.** No config field
   exists yet and no call site passes a strategy — every
   `new RuntimeEngine(...)` is invoked with two args today
   (production `runtime.ts`, backtest `index.ts`, drivers). Resolution
   should live in the adapter factories so backtest/sandbox/live resolve
   identically.

YES make the `config.strategy`:string

2. **Pair-aware entry eligibility.** `guard.allows` capacity checks
   (`guard/entry.ts`) still block any same-symbol position —
   MAIN+COUNTER legs need role-aware dedupe, and `maxOpenPositions` must
   count pairs ("worker count is not doubled"), not legs.


   
3. **Atomic pair execution.** `onAction` still returns `Position | null`.
   Pair entry needs two coordinated fills with rollback (close leg 1 if
   leg 2 fails) — either a `RuntimePairEntryDecision` returning
   `Position[]` or two leg decisions sharing `pairId` executed atomically
   by the adapter.
4. **Decision metadata slot.** `pairId`/`role`/`entryLegs` are
   strategy-owned data; decisions carry `vPointUsage` but no generic
   strategy payload yet (tracked in `StrategyAPI.decisions` doc).
5. **Coordinated exit.** `monitorPosition`/`exit` still handle one
   position at a time — `BOTH:VOLATILITY_TARGET_EXIT` /
   `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS` need a pair-exit decision or a
   post-exit counterpart lookup. (Iteration is safe — stages iterate a
   copied array.)
6. **Config fields.** `management.openDirection` ("ONE_WAY" | "BOTH"),
   per-account `trading.entryLegs`, and `futuresPositionMode` for
   hedge-mode validation are not in `RuntimeManagementConfig` /
   `RuntimeAccountTradingConfig`.
7. **`state.strategy` persistence across restart.** The slot survives
   snapshots/replays but not a live engine restart — `createState`
   (`production/factory.ts`) rebuilds state per account and does not load
   a persisted strategy record yet.



# Human proposed architecture

Here my proposed architecure.

the production adapter will have port to be plugged with strategy API.

```tsx
interface StrategyAPI {
   onStrategy:OnStrategy
   onExit:OnExit
}
```

so the

lib/strategies/both
lib/strategies/streak

will be just exposing `StrategyAPI`

so in the production adapter we will have like 


const choosenStragey = [config.strategy] lazy import

so we plug choosenStragey.onStrategy  and choosenStragey.onExit into the production adapter

---

# Decided contract

The plug contract is defined in `src/lib/strategy/type.d.ts` (`StrategyAPI`)
and is wired into the shared engine: `RuntimeEngine(state, adapter, strategy?)`
carries it on every `RuntimeContext` (`context.strategy`), so stages swap
`defaultDecision.<family>` for `strategy.decisions.<family>` when present,
fire `strategy.onActionResult` after each `onAction` outcome (before the
env `onStateChange`/`onExit` persistence), and run `strategy.preflight`
during `start()`.

Review of the proposal above: the adapter seam and lazy import are right,
but `{ onStrategy, onExit }` alone under-covers the requirements — those
two are a veto gate and a post-close persistence hook. The contract drops
both and adds:

- `decisions` — per-family candidate producers mirroring
  `defaultDecision.{entry,averaging,exit}.find`. This is how a strategy
  *produces* decisions (both's MAIN+COUNTER pair, streak's re-entries).
- `onActionResult(result, decision, position)` — post-execution
  observation covering both outcomes: `"success"` carries the produced
  position (entries, averagings, and exits — a close is just a success
  whose `decision.type === "exit"`), `"failed"` carries `null`. Strategy
  bookkeeping commits on real fills, never on vetoed or failed
  candidates.
- `state` — dropped as a port; strategy-owned persisted records (e.g.
  streak pending re-entries) live in the free-form
  `RuntimeEngineState.strategy` slot, which `PrecisionRuntimeSnapshot`
  carries so test-case replays reproduce them automatically.
- `preflight` — optional boot validation (e.g. hedge-mode position-mode
  check) before the strategy's first pair entry.

`strategy.onStrategy` was dropped: a veto adds nothing the producer cannot
express — a strategy that wants to constrain a family it does not override
wraps `defaultDecision.<family>.find` and filters the result. Approval of
produced candidates stays environment-side (`guard.allows` ANDs with
`adapter.onActionEnvGuard`; strategies cannot disable account limits); a
close is observed through `onActionResult`; `onAction` is never
strategy-overridable.
