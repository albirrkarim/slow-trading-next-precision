# BOTH DIRECTION TRADING

# Introduction

We are trying to do ping pong trading by betting both directions.

We should using binance account that Position Mode = Hedge mode

# Binance Hedge Mode Requirements

## Account configuration

The account selected for live both-direction trading must have:

- USDⓈ-M Futures enabled.
- Binance Position Mode set to `HEDGE`.
- Its account configuration set to `futuresPositionMode: "HEDGE"`.

The runtime must verify the authoritative position mode from Binance before
opening a pair. If the configured mode and the Binance account mode do not
match, entry must be blocked with an actionable error. The runtime must not
silently change the account mode while positions or open orders may exist.

Sandbox must model the same Hedge Mode behavior even though it does not call
Binance.

TC: `PROD:VALIDATE_HEDGE_POSITION_MODE_LIVE`

TC: `PROD:VALIDATE_HEDGE_POSITION_MODE_SANDBOX`

## Order direction

Every live futures order for a paired position must include the leg's explicit
Binance `positionSide`:

| Operation             | Unified side | Binance `positionSide` |
| --------------------- | ------------ | ---------------------- |
| Open or average LONG  | `BUY`        | `LONG`                 |
| Close LONG            | `SELL`       | `LONG`                 |
| Open or average SHORT | `SELL`       | `SHORT`                |
| Close SHORT           | `BUY`        | `SHORT`                |

Binance Hedge Mode does not use `reduceOnly` for these orders. A close is made
direction-safe by sending the opposite order side with the same explicit
`positionSide` and no quantity greater than the open leg.

Position lookup, reconciliation, monitoring, averaging, and exit logic must
identify a live position by account, symbol, and position side. A symbol-only
lookup is invalid because both `LONG` and `SHORT` can exist simultaneously.

TC: `PROD:HEDGE_ORDER_POSITION_SIDE`

TC: `PROD:HEDGE_POSITION_RECONCILIATION`

# A. Scenario

## Scenario 1: High level, entry on level 1

Example volatility-point path:

`TOP[1]-A -> TOP[2]-B -> TOP[3]-C -> BOTTOM[0]-D`

Current thought: we should open `SHORT` on level 1, average into level 3, then
exit on level 0.

But we waste the movement from level 1 to level 3. It can be profitable if we
open a `LONG` position at the same time.

So we need two position. Both position leg can average when price reaches their
next adverse level.

This both-direction rule is stronger than the general low-level averaging
guard. A verified `MAIN` or `COUNTER` leg may consume its exact next adverse
watch step even when that step is level `1` or `-1`. For example, a LONG entered
at `L0` may average at `L-1`, and a SHORT entered at `L0` may average at `L1`.
It may not skip directly to an unrelated low-level step. One-way trading keeps
low levels observation-only. For a non-zero entry, the first later `L0` is the
volatility target, so the target guard blocks averaging there.

The permission belongs to the pair lifecycle. If one leg closes first, the
surviving leg keeps this permission because the closed counterpart remains
identifiable from pair history.

TC: `BOTH:LOW_LEVEL_NEXT_ADVERSE_AVERAGING`

`main leg` for `main direction`

`counter leg` for `counter direction`

Both legs can exit when the target vPoint is reached (`BOTTOM[0]-D`) through
`BOTH:VOLATILITY_TARGET_EXIT`.

for that example

`main leg`:

- Open `SHORT` and average, so we can reduce the loss or even make a small
  profit.

- It has all exit logic that we have, not always `BOTH:VOLATILITY_TARGET_EXIT`, depend of what first condition are met.

`counter leg`:

- Open `LONG` and push profit while the move from level 1 to level 3 continues.
- It can exit through `BOTH:VOLATILITY_TARGET_EXIT` when the last volatility
  point returns to level 0 after traveling through high levels.
- by default counter direction disables only traditional percentage take-profit and
  `PROD:SL_PLUS`. Stop-loss and structural volatility exits stay enabled as OR
  conditions.
- It might triggered exit when `PROD:REENABLE_TP_LOGIC_AFTER_AT_LEAST_ONE_LEVEL_TO_PROFIT_DIRECTION_PASSED_AND_OTHER_SIDE_WAS_CLOSED` condition happen.

## Scenario 2: Low Level, entry on level 0

`BOTTOM[0]-A -> TOP[1]-B -> BOTTOM[0]-C`

When the minimum actionable level is `0`, we can enter more aggressively.

At the same time, both leg open positions.

`main leg` opens `LONG` because the level is `BOTTOM`, so the `main direction`
is `LONG`.

`counter leg` opens `SHORT` because it is the counter direction.

`main leg` may take profit directly.

`counter leg` may average one step at its next adverse level, including `L1` or
`L-1`, and may exit by
`BOTH:VOLATILITY_TARGET_EXIT`, `BOTH:VOLATILITY_TARGET_SL_VALUE`,
`BOTH:VOLATILITY_TARGET_TP`, `BOTH:POST_AVERAGE_STOP_LOSS`, or
`BOTH:POST_AVERAGE_RESCUE_EXIT`, depending on which condition is met first.
Normal percentage TP stays disabled for counter direction.

## Scenario 3: Main doing TP and the counter still open

`BOTTOM[0]-A -> BOTTOM[-1]-B -> TOP[0]-C`

For example like this

`main leg` open LONG
`counter leg` open SHORT

`main leg` may take profit directly but not reaching of forming the volatility point `TOP[1]` with the tp pct is just 1% it can hapen because currently the VOLATILITY_THRESHOLD=2

then it goes to the `BOTTOM[-1]-B` so `counter leg` will profit right. but since the `counter leg` TP rule by TP pct and stop loss plus is disabled by default. so it will closed on the `TOP[0]-C` make it might not profitable.

so better to make condition like this when the position on the `main leg` same symbol is already closed && it has pass at least one volatility level to their profit direction. the `counter leg` can doing TP logic as usual.

so that TP logic will be used first before it reaching exit `BOTH:VOLATILITY_TARGET_EXIT` condition

TC: `PROD:REENABLE_TP_LOGIC_AFTER_AT_LEAST_ONE_LEVEL_TO_PROFIT_DIRECTION_PASSED_AND_OTHER_SIDE_WAS_CLOSED`

## Scenario Behavior

Each leg has different exit rules.

`main leg` as `main direction` can use all current exit logic.

`counter leg` as `counter direction` can use all current exit logic except
take-profit by percentage (`BOTH:TRADITIONAL_TP_SL`) and stop-loss plus
(`PROD:SL_PLUS`). Those rules might exit too early before
`BOTH:VOLATILITY_TARGET_EXIT`, so counter positions prefer structural volatility
exits. Except the `PROD:REENABLE_TP_LOGIC_AFTER_AT_LEAST_ONE_LEVEL_TO_PROFIT_DIRECTION_PASSED_AND_OTHER_SIDE_WAS_CLOSED` condition.

Both positions must support `BOTH:VOLATILITY_TARGET_EXIT`. When this condition
is reached, it resets both sides of the two-leg position pair same symbol.

## Definition

### `BOTH:VOLATILITY_TARGET_EXIT`

The position pair is armed immediately when its entry vPoint has a non-zero
level. The first later vPoint at level `0` is then the volatility target and
triggers `BOTH:VOLATILITY_TARGET_EXIT`.

An entry at level `0` does not arm or satisfy the target by itself. In that
case, the first later non-zero level arms the rule and the next later level `0`
is the target.

Examples:

- `TOP[1]-A -> TOP[2]-B -> TOP[3]-C -> BOTTOM[0]-D`: the target is
  `BOTTOM[0]-D`.
- `BOTTOM[-2]-A -> TOP[0]-B`: the non-zero entry arms the rule and the target
  is `TOP[0]-B`.
- `BOTTOM[0]-A -> TOP[1]-B -> BOTTOM[0]-C`: the target is `BOTTOM[0]-C`.
- `BOTTOM[0]-A -> BOTTOM[-1]-B -> TOP[0]-C`: the target is `TOP[0]-C`.

This rule is direction-agnostic. It does not depend on whether a volatility
point is `TOP` or `BOTTOM`. A non-zero entry is already an armed path; a
level-zero entry must first move to a non-zero level. Once armed, the next
post-entry level `0` is the target.

This is the single volatility-target definition used by
`BOTH:VOLATILITY_TARGET_EXIT`, `BOTH:VOLATILITY_TARGET_SL_VALUE`, and
`BOTH:VOLATILITY_TARGET_TP`. A move from entry `TOP[0]` to `BOTTOM[-1]`, for
example, only arms the target; it does not trigger target TP or target SL. A
later `TOP[0]` is the target. While both pair legs remain open,
`BOTH:VOLATILITY_TARGET_EXIT` has priority at that target and closes the pair.

# B. Data structure

## Accounts

btw on the accounts crud json i need i can define the account position mode.

## Position

read the existing `Position` data type first

```tsx
interface Position {
  role: "MAIN" | "COUNTER";

  // other things
}
```

## Trading

- Worker Pair

Currently we check spendable balance for a single worker. With `two leg strategy` we
need allocation for a worker pair because we open the same coin in both
directions (`LONG` / `SHORT`).

When there is not enough spendable balance for the worker pair, even if there is
enough for one direction, it is better not to open either position.

System-capacity estimates also treat one worker as one pair. Worker count is
not doubled, but its entry margin and reserved averaging ladder are funded for
both legs. Peak effective capital is the sum of concurrent pair worker costs
plus the single largest active unreserved bailout step, matching the production
entry guard.

Historical take-profit capacity may show cumulative gross `MAIN`-leg TP, but it
must not label that amount as pair net profit. `COUNTER` PnL, fees, funding, and
slippage require the complete pair lifecycle and are excluded from that gross
figure.

TC: `BOTH:ENTRY_BOTH_DIRECTION`

- Must entry close the vpoint.price

see `PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT` it protect entry when price drift from vpoint.price to the profit direction. using pct how it has drift.

The guard is controlled per account by
`trading.lateEntryVPointPriceDriftEnabled` and defaults to enabled. Disabling it
skips the late-entry price-zone check only for that account's future live and
sandbox entries.

but allowed to the adverse direction.

since we entering both direction the rule is we must protect

When `VOLATILITY_THRESHOLD < 5`, block drift greater than `0.5%`.
When `VOLATILITY_THRESHOLD >= 5`, block drift greater than `1%`.

the entry zone is current price between vpoint.price + 0.5% && vpoint.price - 0.5% outside than that we must block and wait until the current price is on that entry zone.

so modify the `PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT`

- Exit together when stop loss

When either leg exits from the percentage hard stop in
`BOTH:TRADITIONAL_TP_SL` or the fee-adjusted net USDT stop in
`BOTH:STOP_LOSS_BY_USDT_LOSS`, close the matching open leg too. The coordinated
leg keeps the originating stop-loss reason: `STOP_LOSS` for the traditional
hard stop or `STOP_LOSS_BY_USDT_LOSS` for the net USDT stop.

TC: `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS`

# C. UI

## C.1 Both leg Open position

For now we have `Open Positions`, so we need three columns:
`[Open Positions Main]` `Coins usdt pnl` `[Open Positions Counter]`.

the `Coins usdt pnl` column will be show the current net usdt pnl of some coin. based on that position on two leg.

When one leg is closed while the other leg remains open, keep the closed leg in
the paired UI, show the `Closed` chip, and use the active theme's default
background color rather than a hardcoded white background.

i think better to not removing the position json on that open position data list. but on the background it produce copy to the trade history storage. because it was closed.

only remove from "open position data list" when both leg has close that coin position.

TC: `PROD:OPEN_POSITION_BOTH_LEG`

## C.4 Live preview

on the setting ui > trading tab we have live preview right.

we must update it, based on this new strategy.

for example like this

entry -> stage 1 -> stage 2 -> stage 3 -> exit level 0

`main leg` will doing averaging on the stage 1-3

so the margin is increased. but hte `counter leg` is not increase the margin.

so the current stop loss is based on `main leg`

i need to show when it end up with stop loss each stage

- loss amount of the `main leg`
- net loss amount ( loss amount from `main leg` reduced by profit from the `counter leg` ) with their margin on that current stage. because the `main leg` will keep increasing the margin, but not margin from `counter leg` because of its not their adverse level.

# D. Conclusions

The goal is to let the counter leg cover small losses from the main leg, but
losses are still possible from averaging, fees, funding, slippage, transfer
delay, and stop-loss events.

# E. FAQ

## Does `BOTH:VOLATILITY_TARGET_EXIT` overlap with existing volatility exits?

Yes, it is intentionally an OR condition with the existing volatility exits.
When `BOTH:VOLATILITY_TARGET_EXIT` happens first, the system exits with that
rule. Otherwise, `BOTH:VOLATILITY_TARGET_TP`,
`BOTH:VOLATILITY_TARGET_SL_VALUE`, `BOTH:POST_AVERAGE_RESCUE_EXIT`, or normal
stop-loss may exit first when their conditions are met. The configured
`BOTH:POST_AVERAGE_STOP_LOSS` may also exit first after an averaging tier has
been reached.

## How is the feature enabled?

We need setting on the setting > management tab

it will has option `config.openDirection` one way or both

when one way so it just open the `main leg`

## Order fail handling

Binance pair entry requires two sequential orders. If the first leg fills but the second fails, should SLOW immediately close the filled leg and report the pair entry as failed?

yes, so it never intentionally leaves an accidental unpaired position.

## config each account trade leg

1. Should the new selector be per account under Trading → Entry, as shown in your screenshot?

   yes. Add:

   ```ts
   entryLegs: "MAIN" | "COUNTER" | "BOTH";
   ```

   This lets each account independently select which legs it opens. Keep the shared `openDirection` as the master switch for the overall one-way/BOTH strategy.

2. What should the default `entryLegs` value be?

   I assume `BOTH`, based on your request. This would be a new default specifically for `entryLegs`; the existing application default is currently `openDirection: "ONE_WAY"`.

3. How should COUNTER-only exits behave when no MAIN leg exists?

   Currently, COUNTER disables ordinary percentage take-profit and Stop-Loss Plus until its MAIN counterpart closes. With COUNTER-only, that event can never happen.

   Answer: retain COUNTER structural behavior, but treat “MAIN intentionally not opened” like “MAIN already closed,” allowing normal TP after the counter passes one level in its profit direction.

4. When shared `openDirection` is `BOTH`, should MAIN-only and COUNTER-only accounts still require Binance Futures Hedge Mode?

yes. They remain legs of the Hedge strategy, use explicit `positionSide`, and can safely change to BOTH later. Only true `ONE_WAY` mode would support One-way Mode/spot.

5. Changing `entryLegs` will affect only future entries. Existing MAIN/COUNTER positions will continue being managed using their stored roles. I assume this is correct.

yes

Implementation contract: `entryLegs` defaults to `BOTH`, is persisted in each
account's Trading configuration, and is ignored when shared `openDirection` is
`ONE_WAY`. Backtest and production must open and fund exactly the selected legs.
The selected Hedge entry shape is captured on new positions so later account
configuration changes do not alter their exit behavior.

TC: `BOTH:ACCOUNT_ENTRY_LEGS`
