# Both strategy

`both` trades a signal's direction as the MAIN leg and the opposite direction
as the COUNTER leg. It is selected by `management.strategy: "both"` and runs
through the same `RuntimeEngine` in backtest, sandbox, and live trading. With
no strategy selected, the engine uses its default trading decisions instead.

## Entry and capacity

Each account's `trading.entryLegs` chooses which legs to open:

| Value | Entry |
| --- | --- |
| `BOTH` (default) | One coordinated MAIN + COUNTER pair entry. |
| `MAIN` | Only the signal-direction leg. |
| `COUNTER` | Only the opposite-direction leg. |

Automatic signals use the normal entry scan; operator-forced entries are
reshaped by the same strategy entry hook. Both legs share a `pairId` built
from the account, symbol, and entry vPoint ID. Their role and entry-leg
selection travel from the decision to `position.strategy.logic`, and each
role marks its own vPoint usage.

For `BOTH`, the entry planner checks both legs against the same spendable
balance before execution. If either leg cannot be planned, or their combined
margin, fee, and reserve cannot be funded, the pair is skipped. The pair
executor attempts to roll back an already-filled leg if the next leg fails.
One open pair counts as **one worker** toward `maxOpenPositions`; another
fresh pair on the same account and symbol is blocked while either leg is
open. The strategy guard still applies the shared runtime, entry-policy,
and averaging checks.

## Averaging and exits

Paired legs use the shared averaging decision with the `lowLevel` gate. This
allows the exact next adverse watch step at level `±1`; the shared
no-level-skip and funding rules still apply. Positions without pair metadata
keep the default averaging and exit pipelines.

For a paired leg, exit decisions are checked in this order:

1. A pending coordinated close force-closes the surviving leg with the
   originating reason.
2. A volatility target force-closes the leg at the first *later* level-0
   vPoint after it is armed. A non-zero-level entry starts armed; a level-0
   entry must first see a later non-zero level. The entry point itself is
   never the target.
3. Otherwise, the shared exit evaluator runs. MAIN uses its normal rules.
   COUNTER has percentage take-profit and Stop-Loss+ disabled until its MAIN
   sibling is gone and a later vPoint has moved at least one level toward
   COUNTER's profit direction. The other shared exit rules remain available.

After a successful exit, `STOP_LOSS`, `STOP_LOSS_BY_USDT_LOSS`, and
`VOLATILITY_TARGET_EXIT` mark the surviving sibling for a coordinated close.
Other exit reasons do not automatically close it. While one leg remains
open, a slim snapshot of the closed leg is kept for the paired UI; the
snapshot and pending-close record are cleared when no leg remains. Unlike
`streak`, `both` does not reopen a closed role.

## Example scenarios

These follow the volatility-point paths in
[`BOTH_DIRECTION_TRADING.md`](../../../../docs/TODO/strategy/BOTH_DIRECTION_TRADING.md).
They show which decisions *can* happen; another enabled exit rule may close a
leg before the final point.

### 1. Enter above level 0

`TOP[1]-A → TOP[2]-B → TOP[3]-C → BOTTOM[0]-D`

- At A, the signal opens MAIN **SHORT** and COUNTER **LONG**. Since the entry
  level is non-zero, the volatility target is already armed.
- As the path rises through B and C, MAIN may average at its exact next
  adverse steps. COUNTER can benefit from the rise, but its ordinary
  percentage TP and Stop-Loss+ are initially disabled.
- D is the first later level-0 point, so any legs still open are eligible for
  `VOLATILITY_TARGET_EXIT`. A successful target exit on one leg schedules the
  other leg to close with the same reason.

### 2. Enter at level 0

`BOTTOM[0]-A → TOP[1]-B → BOTTOM[0]-C`

- At A, MAIN opens **LONG** and COUNTER opens **SHORT**. A is the entry point,
  not an exit target.
- B arms the target. It is also the next adverse level for COUNTER, so that
  leg may average there if the other averaging conditions permit. MAIN may
  exit earlier under its ordinary exit rules.
- C is the first level-0 point *after arming*. Any surviving leg can take
  the volatility-target exit there.

### 3. MAIN exits before COUNTER

`BOTTOM[0]-A → BOTTOM[-1]-B → TOP[0]-C`

- MAIN opens **LONG** and COUNTER opens **SHORT** at A. Suppose MAIN takes
  its ordinary percentage TP and closes before B. That exit alone does not
  force COUNTER to close; the paired UI retains MAIN's closed-leg snapshot.
- B is one level toward COUNTER's profit direction. With MAIN gone, this
  re-enables COUNTER's ordinary percentage TP and Stop-Loss+ checks. COUNTER
  may therefore take profit before the later target.
- If COUNTER remains open, C is the armed level-0 target and can close it. Once
  both legs are closed, the pair's temporary strategy records are cleared.

## Runtime and source map

The strategy's `closed` and `pendingClose` records live in the versioned
`state.strategy` slot (`v: "both"`). Production persists that state after
engine actions; backtest and precision snapshots carry it through the shared
runtime. For sandbox and live accounts using `entryLegs: "BOTH"`, preflight
requires a declared `HEDGE` futures position mode. Backtest skips that
exchange-specific check.

- [`index.ts`](./index.ts) — strategy registration and post-exit bookkeeping.
- [`exit.ts`](./exit.ts) — target, cascade, and shared-exit selection.
- [`state.ts`](./state.ts) — versioned pair-close state.
- [`../shared/entry.ts`](../shared/entry.ts) — pair construction and funding.
- [`../shared/guard.ts`](../shared/guard.ts) — pair-aware capacity and shared gates.
- [`../shared/pair.ts`](../shared/pair.ts) — pair IDs, metadata, roles, and worker counting.

The strategy contract is in [`../types.ts`](../types.ts). Behavior tests live
under `src/__dev__/main/quality/precision/`, including
`multi-strategy.test.ts`.
