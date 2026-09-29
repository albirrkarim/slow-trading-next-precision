# Streak strategy

`streak` is the close-and-reopen pair strategy selected by
`management.strategy: "streak"`. It uses the same `RuntimeEngine` in backtest,
sandbox, and live trading. MAIN follows a fresh signal, COUNTER trades the
opposite direction, and each leg can close independently at a favorable
volatility-point rail. See the [origin scenarios](../../../../docs/TODO/strategy/STREAK_BREAK_TRADING.md)
for the intended trading path.

## Entry and re-entry

An account's `trading.entryLegs` selects `BOTH` (the default), `MAIN`, or
`COUNTER`. A fresh `BOTH` signal plans and funds both legs before a coordinated
pair entry; one pair occupies one `maxOpenPositions` worker slot. MAIN-only or
COUNTER-only accounts open just the selected role.

When one leg closes and its sibling remains open, the strategy records the
empty role under `state.strategy.roles`. On later entry passes it attempts to
reopen that role:

- Direction is opposite the surviving leg; the MAIN/COUNTER role does not
  switch when the volatility rail changes.
- The anchor is the **newest confirmed vPoint** at or after the survivor's
  entry that this account and role have not used for an entry. A vPoint used
  by the other role or for averaging can still qualify.
- A successful re-entry gets a new base entry margin and averaging ladder.
  Its role-specific usage marker is committed only after the fill succeeds.
- Entry guards still apply, including late-entry price drift. A blocked or
  failed attempt leaves the role empty, records a reason, and can retry with
  a newer eligible anchor on the next pass.

If no sibling survives, the pending role record is removed. A later eligible
signal can start a fresh pair. A one-leg account likewise waits for a fresh
signal after its sole leg closes; it does not run the sibling-based reopen
loop.

## Exits and averaging

For a paired leg, the first confirmed vPoint *after entry* with label `TOP`
is a LONG target; the first later `BOTTOM` is a SHORT target. Its numeric
level does not matter, and the leg's own entry vPoint is excluded. A target
closes **only that leg**, never its sibling. Hard stops, USDT stops,
post-average exits, rescue exits, and other shared rules remain independent
OR conditions; a stop on one leg does not cascade to the other.

Ordinary percentage take-profit and Stop-Loss+ are initially disabled for
paired legs. They re-enable when the current price has moved at least
`VOLATILITY_THRESHOLD` toward that leg's profit direction from the latest
available vPoint price. This price-distance exception does not require a
new confirmed target vPoint. Positions without pair metadata use the default
exit rules.

The averaging producer allows an adverse-side vPoint, including level 0, to
be considered as the next step. The shared ladder, level-distance, guard,
and funding checks still decide whether it can execute. See the known gap
below for entries made on their own favorable rail.

## Example scenarios

The paths below are adapted from the origin document. They describe candidate
decisions, not guaranteed fills or PnL: an earlier exit, a blocked entry, or
the configured averaging limits can change the outcome.

### 1. Alternating favorable rails

`TOP[0]-A → TOP[1]-B → TOP[2]-C → TOP[3]-D → BOTTOM[0]-E → BOTTOM[-1]-F → TOP[0]-G`

- At A, MAIN opens **SHORT** and COUNTER opens **LONG**.
- B is a later TOP, so it can close COUNTER LONG while MAIN SHORT remains.
  With MAIN still open, COUNTER can reopen LONG at the newest unused anchor,
  normally B if no newer point or guard intervenes. C and D can repeat that
  cycle. MAIN can independently consider adverse averaging on rising TOPs.
- E is a later BOTTOM, so it can close MAIN SHORT without closing COUNTER.
  MAIN can then reopen SHORT opposite the surviving LONG; F can repeat the
  SHORT rail exit. The origin scenario also expects the LONG to average on
  E and F, subject to its ladder and stop-loss rules, but the current
  averaging caveat below can prevent this.
- G is a later TOP and can close a surviving LONG. With a SHORT sibling
  still open, its role can attempt another re-entry.

### 2. Different account entry ranges

Account 1 uses `entryLegs: "BOTH"`, absolute entry levels `0–2`, and at most
two next averaging levels. Account 2 uses `entryLegs: "MAIN"` and absolute
entry levels `3–5`.

`TOP[0]-A → TOP[1]-B → TOP[2]-C → BOTTOM[0]-E → BOTTOM[-1]-F → BOTTOM[-2]-G → TOP[0]-H`

At C (`TOP[2]`), assuming its symbol slot is free, Account 1 can be eligible
for a pair while Account 2's entry range excludes the point. Account 1's
SHORT can later exit on a BOTTOM rail while its LONG remains exposed; other
configured exits may act sooner. Account 2 does not offset Account 1's PnL
merely by having a higher-level entry plan. The origin's proposed LONG
averaging at E/F is subject to the caveat below.

## Known gap versus the origin scenario

The [streak exit producer](./exit.ts) excludes a position's entry vPoint when
finding its favorable target. The [shared averaging guard](../../system/trading/averaging.ts)
currently does **not** exclude it: for a LONG reopened on a TOP (or SHORT
reopened on a BOTTOM), it can treat that entry point as a target already hit
and suppress later adverse averaging. For example, a LONG reopened at
`TOP[3]-D` may not average at `BOTTOM[0]-E` as Scenario 1 expects. This
README documents the discrepancy; it does not change the trading code.

## Runtime and source map

The versioned `state.strategy` slot (`v: "streak"`) persists empty-role
records and their latest blocking reasons, not a fixed anchor. The paired
open-position board shows configured coins and the empty role's reason
inline until it fills. Sandbox and live preflight require a declared
`HEDGE` futures position mode for enabled `entryLegs: "BOTH"` accounts;
backtest has no exchange position-mode check.

- [`index.ts`](./index.ts) — strategy registration and result bookkeeping.
- [`entry.ts`](./entry.ts) — newest-unused-anchor role re-entry and fresh pairs.
- [`exit.ts`](./exit.ts) — direction-based rail exit and TP/SL+ exception.
- [`guard.ts`](./guard.ts) — pair guard plus empty-role rejection reason.
- [`state.ts`](./state.ts) — persisted pending-role records.
- [`../shared/entry.ts`](../shared/entry.ts) and [`../shared/pair.ts`](../shared/pair.ts) — shared pair funding, role metadata, and vPoint usage.

The strategy contract is in [`../types.ts`](../types.ts). Focused behavior
tests are in `src/__dev__/main/quality/unit/strategies.test.ts`.
