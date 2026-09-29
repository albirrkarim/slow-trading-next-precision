# Profit Rail strategy (swe_2)

`custom_swe_2_profit_rail_v1` is a `streak` variant selected by
`management.strategy`. Same pair machinery (MAIN + COUNTER legs, sibling
re-entry, shared pair funding), two behavior changes aimed at the
low-level harvesting bleed measured on the `streak` baseline.

## What it does differently

### 1. Rail exits require non-negative net PnL

In `streak`, the first confirmed post-entry counter point (TOP for LONG,
BOTTOM for SHORT) force-closes the leg **regardless of PnL**. On shallow
waves (|lvl| ≤ 2) that rail often forms at an adverse price, so the leg
books a realized loss — in the measured baseline this was the dominant
leak (~87 exits averaging ≈ -1.9 USDT on a $60 account).

This strategy fires `VOLATILITY_TARGET_EXIT` only when
`position.pnl.netPct >= RAIL_EXIT_MIN_NET_PCT` (module constant `0` in
`exit.ts`). An underwater rail is not consumed — it stays the earliest
target, so the leg exits on the first later pass where it is no longer at
a loss. Held legs are still bounded by every other shared rule: the
volatility-target stop loss (active once a target zone exists),
`stopLossUSDT`, `stopLossPercent`, level drift stop, `exitOnVPointAbsLevel`,
post-average rescue/stop exits, and SL+ once the favorable-distance
exception re-arms it.

### 2. Re-entry anchors respect the account level band

`streak` re-entries anchor at the newest confirmed unused vPoint with **no
level bound** — a shallow-band account could re-enter on a level-4 anchor
and hold a deep-wave bag it was never sized for. Here the anchor scan
(`newestUnusedAnchor`) skips points outside the account's
`minEntryAbsLevel`/`maxEntryAbsLevel`, so an account's re-entries stay in
its own band. Roles whose only unused anchors are out-of-band stay pending
with a `waiting for a confirmed unused vPoint inside the entry level band`
reason.

## Handoff level it encodes

Designed for the two-account cover split:

- **Entry/harvest side** (e.g. account 1): `entryLegs: "BOTH"`,
  `minEntryAbsLevel: 0`, `maxEntryAbsLevel: 2` — pairs and re-entries stay
  on shallow waves, and the profit gate turns chop churn into scratches or
  small wins instead of realized losses.
- **Cover side** (e.g. account 2): `entryLegs: "MAIN"`,
  `minEntryAbsLevel: 3` — mean-reversion entries on deep waves only, with
  the same profit gate on its rail exits.

## Config knobs it reads

All account `trading` knobs are honored unchanged — the open decision
points are `minEntryAbsLevel`/`maxEntryAbsLevel` (the handoff band),
`watchMaxNextAveragingLevels`/`watchReserveLevels`/`watchReservePctAlloc`
(averaging depth + reserve cost), `stopLossUSDT`/`levelBasedPctDriftStopLoss`
/`volatilityTargetStopLossPercent` (the loss bound for held legs),
`takeProfitPercent`/`stopLossPlusTrigger` (SL+ arm/trail once re-enabled),
and `entryLegs` (pair vs one-way per account).

## Why it should hit the goal

The daily-income score needs high `tradesPerDay` and `winRate` **plus**
`sharpeRatio` and a positive `monthlyGain.min`. The baseline combined run
produced ~2.4 trades/day but bled on loss-side rail exits and starved the
cover account through the shared daily-PnL gate. Removing realized-loss
rail exits should keep the volume while flipping the harvester toward
scratch-or-better — the cover account keeps the deep-wave edge that made
the reference board entry profitable.

## Source map

- [`index.ts`](./index.ts) — strategy registration and bookkeeping.
- [`entry.ts`](./entry.ts) — in-band newest-unused-anchor role re-entry.
- [`exit.ts`](./exit.ts) — profit-gated rail exit + TP/SL+ exception.
- [`guard.ts`](./guard.ts) — pair guard plus empty-role rejection reason.
- [`state.ts`](./state.ts) — persisted pending-role records.

Shares [`../shared/`](../shared/) pair funding, meta, close, diagnostics,
and preflight with `both`/`streak`.
