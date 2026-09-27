# Multi-strategy: current pain points

## Purpose

Find where today's Precision/Multi behavior conflicts with running Both and
Streak on the shared runtime. Each point has a proposed solution to review
**one at a time**. These are design proposals, not approved behavior or an
implementation plan.

Sources checked: `docs/SPECS/_SPECS.md`, the current runtime, production and
backtest call sites, `slow-trading-next-hedge/docs/slow/HEDGE/BOTH_DIRECTION_TRADING.md`,
and `slow-trading-next-streak/docs/slow/SPECS/TRADING.md`. The instance documents
are inputs to compare, not automatically the specification for this repository.

## Current condition

`RuntimeEngine` accepts an optional `StrategyAPI`; its entry, averaging, and
exit monitors can call strategy decision producers. `onActionResult` and
`preflight` also exist. Production, Precision backtest, quick backtest, and
one-off production passes all construct the engine without a strategy. There
is no strategy selector or `src/lib/strategies/` implementation yet. The hooks
therefore have no effect in the current running flows.

Multi assumes one active position per account and symbol, one decision
producing one position, and one leg being monitored or closed at a time. A flat
`openPositions` array can store two legs; the lifecycle is not pair-aware.

## Pain points to resolve, one by one

### 1. Both and Streak disagree about the pair lifecycle

The Hedge document says the first later level `0` can close the pair through
`BOTH:VOLATILITY_TARGET_EXIT`, and certain stops close the counterpart too
(`BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS`). The Streak spec defines a directional
target for each leg, keeps the other leg open after automatic exits, and later
re-enters a missing role. Their percentage-TP rules also differ. Shared pair
identity or helper functions do not settle these policy conflicts.

**Proposed solution:** Give `both` and `streak` separate policy modules. `both`
implements the Hedge document's level-0 pair target and coordinated stops;
`streak` implements its directional per-leg targets, independent stops, and
re-entry. Share only mechanics whose behavior is genuinely identical (pair
identity, funding, exchange orders, and accounting). Before implementation,
write a short event trace for each strategy showing entry, target, stop, and
the expected open legs after every event. Use those traces as backtest,
sandbox, and live contract tests. Do not silently make one document override
the other.

### 2. The hook changes candidates, not the whole trade lifecycle

`StrategyDecisionProducers` returns ordinary entry decisions and one
averaging/exit decision per position. The engine still runs fixed eligibility,
execution, balance, vPoint, and persistence steps. A producer can suggest two
legs, but cannot make those steps treat them as one funded worker or coordinated
operation. `onActionResult` runs after an action, too late to prevent a partial
pair fill.

Evidence: `src/lib/strategy/type.d.ts`,
`src/lib/precision/monitoring/{entry,position}.ts`.

**Proposed solution:** Extend the producer result from individual decisions to
a discriminated *intent*: single-leg entry, selected-leg pair entry, single-leg
exit, or coordinated exit. The shared engine validates and accounts for the
intent as one operation; each environment adapter executes its legs and returns
a structured outcome with every fill and any recovery action. Keep the current
single-position path as the default Multi intent. Call `onActionResult` once
for the complete outcome, after state bookkeeping. Strategy modules still
decide *what* to do; they do not submit exchange orders themselves.

### 3. One-position-per-symbol checks reject the second leg and re-entry

The current spec explicitly requires one active position per symbol
(`BOTH:ONLY_ONE_ACTIVE_POSITION_PER_COIN`). The default producer, engine entry
gate, manual entry builder, and entry diagnostics each enforce it. After the
first pair leg fills, the second is rejected. A Streak replacement leg is also
rejected while its counterpart remains open. Changing only `canAttemptEntry`
would leave the other paths inconsistent.

Evidence: `docs/SPECS/TRADING.md` B.3.2,
`src/lib/system/trading/{entry,entry-diagnostics}.ts`,
`src/lib/precision/monitoring/{entry,manual}.ts`.

**Proposed solution:** Centralize entry eligibility in one shared function used
by automatic entry, manual entry, execution re-checks, and diagnostics. A fresh
worker requires the symbol to have no existing worker for that account. A
missing-role re-entry is allowed only into the same `pairId` when that role is
absent; it never permits a third leg or a second unrelated pair. Apply the
same account, symbol, mode, and risk guards to both cases, with explicit
exceptions only where the strategy spec requires them. Preserve the old
one-position behavior for Multi.

### 4. Worker slots and funding count positions, not pair workers

`maxOpenPositions`, worker-capacity previews, and the entry funding plan use
open-position counts and a one-entry cost. Both/Streak count a pair as one
worker but require capital and averaging reserve for both selected legs.
Sequential legs could approve the first, then reject the second for slot or
capital reasons. Dashboard capacity could disagree with execution.

Evidence: `src/lib/system/trading/{worker-capacity,entry-action}.ts`,
`src/lib/precision/monitoring/entry.ts`; Streak spec B.5.3.

**Proposed solution:** Introduce a shared worker view: each pair ID counts as
one occupied slot, including when only one leg remains; a standalone position
also counts as one. Fund a new intent from the complete selected leg set
before any order: equal adjusted entry margin for a two-leg entry, both fees,
both averaging reserves, and the required bailout buffer. A one-leg selection
funds one leg. Reuse this same calculation for the execution guard, capacity
preview, and diagnostics so the UI cannot promise a worker the engine rejects.

### 5. A pair entry has no failure boundary

`adapter.onAction` and the entry monitor return and commit one `Position` at a
time. After leg one fills, the engine changes balance, consumes the vPoint,
notifies, and persists. If leg two fails, there is no pair-level rollback or
explicit surviving-leg recovery state. Live Binance cannot make two orders
atomic, so cleanup failure must also be represented. Sandbox and backtest need
the same observable outcome rules.

Evidence: `src/lib/precision/monitoring/entry.ts`,
`src/lib/production/{factory,execution}.ts`; both instance entry specs.

**Proposed solution:** Use a pair-entry coordinator in the shared action path.
Plan and approve the complete pair first, then durably record an attempt ID
before the first live order. Place the two orders sequentially, verify each
fill, and compensate by closing any filled leg if the other fails. Mark the
vPoint used and emit success only after both legs succeed. If compensation
succeeds, record its real fees/slippage and reconcile balance; if it fails,
persist the surviving leg as a recovery position, mark it for forced-exit
retry, and block duplicate entry until reconciled. A restart must inspect
unfinished attempts against exchange positions before another entry. Sandbox
and backtest simulate the same outcomes. Exchange orders cannot be truly
atomic; the contract must describe the compensating path.

### 6. Exchange hedge support is not wired through live execution

The Binance adapter understands `positionSide`, but production entry,
averaging, and exit orders do not pass it. Exit requests `reduceOnly`; the
adapter omits that in Hedge Mode, while shared exit confirmation is called
without `positionSide`. A two-leg live position cannot yet be reliably opened,
closed, or confirmed by account + symbol + side. The saved account mode and
Binance's authoritative mode also need validation before pair orders.

Evidence: `src/lib/production/execution.ts`,
`src/lib/exchange/{ensure-closed,adapters/binance}.ts`; Hedge document
"Binance Hedge Mode Requirements".

**Proposed solution:** Store the account's intended futures position mode and
verify Binance's authoritative mode at boot and again immediately before a
live pair entry. Reject a mismatch or failed check without changing the
exchange setting. Require explicit `LONG`/`SHORT` `positionSide` on every pair
entry, averaging order, exit, and residual-close retry. Match reconciliation
and close confirmation by account, normalized symbol, and position side.
Sandbox enforces the configured Binance Futures/HEDGE prerequisites and models
both sides separately; backtest uses the same position identity without
calling Binance.

### 7. Pair identity, role, and old positions need one durable meaning

`Position.strategy` has an immutable entry record and mutable averaging ladder,
but no pair identity or role. Decisions cannot carry them through execution.
Streak re-entry keeps the original pair ID even when its new `opened.t` and
vPoint change. Historical Multi positions have no role; the Precision Checker
pairs by account, symbol, direction, entry vPoint, and normalized role. Storage
and comparison meaning should be settled before choosing a new field shape.

Evidence: `src/lib/system/trading/types.ts`, `src/lib/precision/types.ts`,
`docs/PRECISION/_PRECISION.md` D; Streak spec B.5.1.

**Proposed solution:** Put the fields shared runtime logic needs in typed,
persisted metadata on both the decision and resulting position: strategy slug,
stable pair ID, role, and entry-leg selection at the time of entry. Keep any
strategy-specific `logic` payload separate and opaque. Derive a new pair ID
once from account, normalized symbol, original vPoint ID, and original entry
time; re-entries retain it, while each leg has its own stable position ID for
history edits and Precision matching. Treat old roleless, pairless records as
Multi/MAIN, using the existing legacy comparison key. Never recompute a
position's strategy from today's config after it opens.

### 8. vPoint use is account-wide today

Markers can be written as `"<slug>:<ROLE>"`, but the Multi usage check treats
any marker for that account as use by the whole account. The first leg's marker
can hide the point from the other role. Streak also needs a rule for a newer
unused anchor when re-entry is delayed. Marker format alone does not supply
role-specific eligibility while preserving the one-way rule.

Evidence: `src/lib/system/utils/vpoints.ts` (`hasAccountUsage`),
`src/lib/system/trading/entry.ts`; Streak spec B.5.7.

**Proposed solution:** Give the usage helper an explicit scope: account-wide
for Multi, exact account + role for paired strategies. Legacy account-only
markers remain consumed for all roles to prevent duplicate entries after
migration. A fresh two-leg entry marks both roles only after both fills
succeed; a role re-entry marks only that role after its fill. When a delayed
Streak re-entry sees a newer confirmed vPoint, select the newest eligible
point unused for that role and retain the original pair ID. Diagnostics must
use the same usage query as entry production.

### 9. Per-leg exits and averaging conflict with default monitors

The monitor evaluates one position at a time. Hedge requires some coordinated
closes. Streak requires independent closes, role-specific TP, and missing-role
re-entry. Both specs have pair-aware low-level averaging rules that differ from
one-way Multi. Automatic, forced, and manual paths must agree on which leg or
pair an action targets. Manual exit currently selects by symbol and optional
account, so it addresses every matching leg.

Evidence: `src/lib/precision/monitoring/{position,stages,manual}.ts`,
`src/lib/system/trading/{averaging,exit}.ts`; both instance exit specs.

**Proposed solution:** Let each strategy's policy choose an exit scope (`leg`
or `pair`) and reason, while the shared monitor executes the resulting intent
and accounts for every closed leg. Use stable position IDs to avoid processing
a stale copied-array entry after a coordinated exit. Averaging remains
leg-specific, but the strategy may allow its exact next adverse low-level
step. Extend manual commands with an optional role/position ID for `Close
Leg`, plus an explicit `Close Both`; keep roleless emergency exits
symbol-wide. Test partial pair-exit failure and retry without closing an
already-flat leg twice.

### 10. Strategy state survives a snapshot, not a production restart

`RuntimeEngineState.strategy` is copied into Precision test-case snapshots.
Production `createState` rebuilds engine state from saved accounts, positions,
and vPoints without loading that slot; `persistAccount` does not save it. A
Streak pending re-entry can vanish on restart after its closed leg moves to
history. One-off manual passes can also construct a fresh engine.

Evidence: `src/lib/production/{state,factory,runtime}.ts`,
`src/lib/production/precision-test-case/recorder.ts`; Streak spec B.5.8.

**Proposed solution:** Persist versioned strategy state per account and mode,
including compact pending re-entries, and hydrate it before starting or
manually running the engine. Update it only when the corresponding action
outcome is known. Because positions, history, and strategy state currently
use separate files, make startup reconciliation idempotent: compare pending
records with open positions and closed history, restore a missing pending role
when evidence proves a successful close, and clear stale records after a
successful re-entry or completed pair. If the evidence is incomplete, block
re-entry and surface a recovery diagnostic rather than infer a fill or close
from absence. Capture the hydrated state in Precision snapshots and test
restart at each close/re-entry boundary.

### 11. Configuration and diagnostics still describe Multi

Runtime/account config has no strategy choice, `openDirection`, or per-account
`entryLegs`; production and both backtest factories do not resolve a module.
Entry diagnostics, capacity, trade history, and open-position views assume the
Multi meaning of a symbol and worker. A strategy switch must define how
existing open trades continue when config changes, and what users see for each
blocked or missing leg.

Evidence: `src/lib/system/runtime/types.ts`, `src/lib/production/runtime.ts`,
`src/lib/dev/{backtestPrecision,quick-backtest}`,
`src/lib/system/trading/entry-diagnostics.ts`; Streak spec B.5.8.

**Proposed solution:** Use one canonical strategy selector (`multi`, `both`,
or `streak`) in shared config, defaulting existing installs to `multi`.
Keep `entryLegs` per account for the paired strategies, defaulting to `BOTH`;
do not also store an independent `openDirection` switch that can contradict
the selector. Translate legacy instance settings during import. Resolve the
selected module through one helper used by production, both backtests, and
one-off passes. Reject a strategy switch while open positions or pending
re-entries still belong to the old strategy. Show per-role entry reasons,
open legs, pair net PnL, and role-aware history/Precision results in the UI.

## Suggested discussion order

Start with **1 (strategy behavior)**, then **7 (identity and legacy meaning)**
and **3–5 (entry, capacity, execution)**. Treat **6 (exchange safety)** as a
live-release prerequisite. Work through **8–10 (ongoing lifecycle)** and
**11 (configuration/UI)** against the same examples in backtest, sandbox, and
live. Each proposal can be accepted or revised independently; none is an
approved change to trading behavior yet.
