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
- **Strategy-provided approval gate** — `StrategyAPI.guard` replaces
  `guard.allows` wholesale at every monitoring checkpoint
  (`context.strategy?.guard ?? guard`, the same swap as `decisions`). The
  shared gate is decomposed for delegation — `guard.common` (always-run
  checks returning the resolved account), `guard.entry.{capacity,policy}`,
  `guard.averaging` — so `src/lib/strategies/<slug>/guard` recomposes
  instead of reimplementing.
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

## Still open — Q&A

`A: ___` means a decision is needed from you.

1. **Q — Add `config.strategy` for slug→module selection?** No config
   field exists yet and no call site passes a strategy — every
   `new RuntimeEngine(...)` runs with two args today (production
   `runtime.ts`, backtest `index.ts`, drivers).
   **A:** YES — `config.strategy: string`. Resolution lives in the
   adapter factories (lazy import per the proposal below) so
   backtest/sandbox/live resolve identically.

2. **Q — How does pair-aware entry eligibility land?**
   **A:** Decided — via `strategy.guard`. `lib/strategies/both/guard`
   replaces `guard.entry.capacity` with role-aware dedupe and pair
   counting ("worker count is not doubled"), delegating `guard.common` +
   `guard.entry.policy` for the rest. Pending the `both` module itself
   and the metadata it reads (item 4).

3. **Q — Atomic pair entry shape?** `onAction` returns `Position | null`
   today; pair entry needs two coordinated fills with rollback (close
   leg 1 if leg 2 fails). Options: **(a)** a `RuntimePairEntryDecision`
   type where `onAction` returns `Position[]` — rollback lives wholly in
   the adapter; **(b)** two leg decisions sharing `pairId`, executed as
   one atomic batch by the adapter — reuses the single-position pipeline
   but needs a batch/rollback protocol between engine and adapter.
   **Recommendation:** (a). Atomic operational behavior is the adapter's
   job per the boundary contract, and one decision = one trade intent
   keeps `onActionResult` and balance/vPoint bookkeeping honest per pair
   (each leg is still recorded individually from the returned array).
   (b) leaves the engine orchestrating compensation — a rollback concept
   leaking into strategy-neutral monitoring code. If keeping `onAction`'s
   signature stable matters, an optional `adapter.onPairAction` member is
   the narrower-diff variant of (a).
   **A:** (a)

4. **Q — Where do `pairId` / `role` / `entryLegs` live?** Decisions carry
   `vPointUsage` but no generic strategy payload; positions already have
   `strategy.entry.feature?: TFeature` (supersedes the earlier
   `Position.strategy.logic` sketch). Extend the same pattern — a
   free-form `decision.strategy`/`meta` slot the strategy types itself?
   **A:** Confirmed — `decision.strategy?: unknown` on the decision types
   (matching `state.strategy` / `position.strategy` naming) plus
   `position.strategy.logic?: unknown` as the landing slot. The engine
   copies `decision.strategy → position.strategy.logic` in
   `executeDecision`'s commit step after a successful `onAction` — once,
   uniformly across backtest/sandbox/live, so adapters never reimplement
   the copy. Falls out free: the strategy's `guard` reads
   `role`/`entryLegs` off the decision for pair-aware capacity,
   `onActionResult` correlates legs from decision + position, and
   `decisions.exit.find` reads `position.strategy.logic.pairId` for the
   counterpart lookup in item 5. Averaging/exit decisions use the slot
   only for producer→guard→callback correlation — no propagation.

5. **Q — Coordinated pair exit?** `monitorPosition`/`exit` handle one
   position per pass — `BOTH:VOLATILITY_TARGET_EXIT` /
   `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS` need either a pair-exit decision
   type or a post-exit counterpart lookup in `onActionResult` (safe —
   stages iterate a copied array).
   **Recommendation:** neither new machinery — same-pass producer logic.
   Stages iterate the pre-pass copy of `openPositions`, so the sibling
   leg is still visited this pass: when leg 1 closes, the strategy's
   `decisions.exit.find` on leg 2 sees the pair state (leg 1 closed, via
   the `pairId`/`role` metadata from item 4) and emits its exit in the
   same cycle. Zero new engine surface; the strategy owns pair semantics.
   Fall back to an explicit pair-exit decision only if one-tick ordering
   proves fragile in backtests.
   **A:** Confirmed — no new engine machinery. `decisions.exit` +
   `onActionResult` + `state.strategy` cover it, order-independent:

   - The monitoring loop iterates a snapshot copy
     (`for (const position of [...state.openPositions])`), while a close
     `splice`s the position out of the live array — so the sibling leg is
     always still visited that pass.
   - Same pass (sibling ordered after the closing leg): `both`'s
     `decisions.exit.find` sees the counterpart missing from
     `openPositions` (via `pairId` from item 4) and emits its exit
     immediately.
   - Any order: MAIN's `onActionResult("success")` writes
     `state.strategy.pendingClose[pairId]` — the strategy-owned flag —
     which runs **before** `onStateChange`, so it persists atomically
     with the close. COUNTER's next `exit.find` emits on the flag.
   - `onActionResult` for COUNTER's close clears the flag.
   - Replays reproduce it via `PrecisionRuntimeSnapshot`; a restart
     mid-pair-exit resumes it once item 7's `runtimeStorage.strategy`
     channel lands.

6. **Q — Config field placement?** `management.openDirection`
   ("ONE_WAY" | "BOTH"), per-account `trading.entryLegs`, and
   `futuresPositionMode` for hedge-mode validation are not in
   `RuntimeManagementConfig` / `RuntimeAccountTradingConfig` yet.
   Confirm names and locations?
   **Recommendation:** `management.openDirection` (engine-wide mode),
   `trading.entryLegs` per account ("MAIN" | "COUNTER" | "BOTH"), and
   `futuresPositionMode` on `RuntimeAccountTradingConfig` — it is an
   exchange-account property, not a management one, and `preflight`
   validates it per account at boot.
   **A:** yes


7. **Q — `state.strategy` persistence across restart?** The slot
   survives snapshots/replays but not a live engine restart —
   `createState` (`production/factory.ts`) rebuilds per-account state
   and never loads a persisted strategy record. Persist via a new
   `runtimeStorage` channel, or fold into the existing status file?
   **Recommendation:** a dedicated `runtimeStorage.strategy` channel —
   one compact file per mode (live/sandbox), read in `createState` like
   the status/vpoints bootstrap and flushed in the same `onStateChange`
   write. The status file has its own schema and lifecycle (daily-PnL,
   black-swan); strategy state is free-form `unknown`, so a separate
   channel keeps both schemas decoupled and replay snapshots identical.
   **A:** yes


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
