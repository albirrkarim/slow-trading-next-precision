# What the current system cannot yet do for Both and Streak

`RuntimeEngine` is a usable foundation. It accepts a `StrategyAPI` with entry,
averaging, and exit decision producers, plus `preflight`, `onActionResult`, and
strategy-owned state. This list is about concrete gaps in the *current
end-to-end system*, not a claim that the engine needs replacing. Each item says
where a Both or Streak action would fail today. We can decide how to address
them one by one.

The copied strategy documents in `docs/TODO/strategy/` describe the intended
behaviors; they are not automatically this repository's approved trading spec.

## 1. No running flow selects a strategy

Production, one-off production passes, Precision backtest, and quick backtest
construct `new RuntimeEngine(state, adapter)` without a strategy argument.
There is no selected strategy in runtime config and no Both or Streak module to
resolve. The engine therefore always uses its default Multi decision producers.
Even a complete Both/Streak implementation would not run in any environment
until those call sites pass it in.

Code: `src/lib/production/runtime.ts`,
`src/lib/dev/backtestPrecision/`, `src/lib/dev/quick-backtest/`,
`src/lib/strategy/type.d.ts`.

## 2. Entry eligibility assumes one position per account and symbol

`precision/monitoring/entry.ts` rejects a decision when *any* open position
already has the same account and symbol. A two-leg Both entry would fill the
first leg, then reject the opposite leg. A Streak missing-role re-entry would
also be rejected while the surviving leg remains open. Manual entry repeats
the same check, so changing only the producer would not help. The existing
one-position rule is correct for Multi; the missing capability is eligibility
that can distinguish an existing pair's absent role from an unrelated second
position.

Code: `src/lib/precision/monitoring/entry.ts`,
`src/lib/precision/monitoring/manual.ts`,
`src/lib/system/trading/entry-diagnostics.ts`.

## 3. Capacity and funding are calculated per position, not per pair worker

The entry monitor compares `openPositions.length` with `maxOpenPositions`;
capacity previews use `activePositions.length`. With a one-worker limit, the
first leg occupies the only slot and the second leg fails, even if the
same-symbol guard is relaxed. The entry funding plan also evaluates one
decision at a time. It cannot approve the selected legs, fees, and reserves
as one worker *before* placing the first order. That makes both execution and
the dashboard's capacity preview disagree with pair-worker semantics.

Code: `src/lib/precision/monitoring/entry.ts`,
`src/lib/system/trading/worker-capacity.ts`,
`src/lib/system/trading/entry-action.ts`.

## 4. Pair entry has no all-or-recover outcome

The entry producer returns a flat `RuntimeEntryDecision[]`. The monitor
executes and commits each decision separately: it pushes the position, updates
balance, marks the vPoint, calls `onActionResult`, and persists before trying
the next decision. `onAction` returns only one `Position | null`. If leg two
fails, leg one has already become a successful entry. Neither the strategy
hook nor the adapter can report a single pair-level result, compensate a live
partial fill, or persist an unfinished attempt for restart reconciliation.
This is a shared entry-action boundary, not a missing scheduler capability.

Code: `src/lib/precision/monitoring/entry.ts`,
`src/lib/production/execution.ts`, `src/lib/strategy/type.d.ts`.

## 5. Live execution does not identify the hedge side

The Binance exchange adapter supports `positionSide`, but production entry,
averaging, and exit order parameters do not send it. Exit confirmation also
omits it. A strategy decision cannot repair those orders because production
constructs them afterward. For two opposing futures legs on one symbol, the
live path cannot reliably open, average, close, or confirm the intended side.
The account's actual Hedge Mode must also be checked before paired live orders.
This gap is specific to live execution; backtest still needs equivalent leg
identity, but not Binance order fields.

Code: `src/lib/production/execution.ts`,
`src/lib/exchange/adapters/binance.ts`,
`src/lib/exchange/ensure-closed.ts`.

## 6. Pair identity and role do not travel through the entry path

`RuntimeEntryDecision` has no typed pair ID or leg role, and
`entry-action.applyFill` does not transfer such metadata to the new position.
The existing `Position.strategy.entry.feature` and `RuntimeEngineState.strategy`
can already hold strategy-owned data, and `onActionResult` can update a filled
position. So this is not a demand for a new storage system. The concrete gap
is earlier: pair-aware eligibility, funding, live execution, and later
role-specific actions need to know which pair and role a decision represents
*before* or *as* it is filled. Streak re-entry also has to preserve the original
pair identity while using a new entry point.

Code: `src/lib/precision/types.ts`,
`src/lib/system/trading/entry-action.ts`,
`src/lib/system/trading/types.ts`.

## 7. A required pair close cannot be dispatched as one action

The exit producer and monitor operate on one position at a time. That already
supports Streak's independent per-leg exit and averaging decisions. It does
not guarantee that a Both rule requiring the counterpart to close will act on
both legs in the same pass or give a result for a partial pair close. Manual
exit accepts an account and symbols, not a leg role or pair ID, so an operator
cannot explicitly request “close this leg” versus “close both.” The missing
capability is coordinated targeting and outcome handling, not a new exit
signal hook.

Code: `src/lib/precision/monitoring/position.ts`,
`src/lib/precision/monitoring/manual.ts`,
`src/lib/precision/monitoring/stages.ts`.

## 8. Strategy state is not restored in production

`RuntimeEngineState.strategy` exists and Precision snapshots copy it, but
production `createState` does not hydrate it and production persistence saves
accounts and positions without it. A Streak leg that closes and is waiting for
re-entry can lose its pending record after a restart; one-off passes can start
from a fresh state too. The in-memory engine slot is sufficient, but the
production storage lifecycle does not yet preserve it or reconcile it with
positions and history.

Code: `src/lib/production/state.ts`,
`src/lib/production/factory.ts`,
`src/lib/production/runtime.ts`.
