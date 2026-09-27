# STREAK BREAK TRADING

# Introduction

This document records the rationale and scenarios for the Streak Break Hedge
strategy. The authoritative implementation contract is consolidated in
`../SPECS/TRADING.md` under **B.5 Both-Direction Trading**.

# A. Scenario

## Scenario 1

`TOP[0]-A` -> `TOP[1]-B` -> `TOP[2]-C` -> `TOP[3]-D` -> `BOTTOM[0]-E` -> `BOTTOM[-1]-F` -> `TOP[0]-G`

main leg open SHORT on `TOP[0]-A` so it will averaging and exit on their target right in the `BOTTOM[0]`

counter leg open LONG on `TOP[0]-A` it will profit on `TOP[1]-B` then on that poin reached we close the position.

then open again the LONG position but now the anchor price is price on the `TOP[1]-B` when it goes up again so close again and reopen again.

now the counter leg is open on the `TOP[3]-D` then the point is down into `BOTTOM[0]-E`

so we do averaging right and so on based on the max averaging that we have.

so it will averaging two level point right in `BOTTOM[0]-E` and `BOTTOM[-1]-F` and exit on `TOP[0]-G`

So the system will might always open for opening position, but of course considering entry guard like `PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT`

## Scenario 2

Trading config:

Account 1 config:

- entry on both leg
- entry level abs range is 0 - 2
- maximal average next level = 2

Account 2 config:

- entry on main leg
- entry level abs range is 3 - 5
- maximal average next level = 2

Case:

`TOP[0]-A` -> `TOP[1]-B` -> `TOP[2]-C` -> `BOTTOM[0]-E` -> `BOTTOM[-1]-F` -> `BOTTOM[-2]-G` -> `TOP[0]-H`

Account 1 will doing this. for example we on level `TOP[2]-C` main will TP on the `BOTTOM[0]-E` but the counter leg still open LONG from the
`TOP[2]-C` so it will be averaging on the `BOTTOM[0]-E` and `BOTTOM[-1]-F` then hit stop loss because i set stop loss

using `BOTH:POST_AVERAGE_STOP_LOSS` i have set the maximal loss on account 1 is $5 on averaging 2 levels

so its losses right.

and the losses will not reduced by the Account 2 because the entry level abs range is 3-4 so it will not open on the `TOP[2]-C` because its out of the range.

the our Account 2 when entry on level abs 3 is desined to TP about $8

## Scenario Behavior

Default Behavior:

Both leg has same tp and all the exit rule. the take profit logic like traditional TP and stop loss plus is disabled. we just using the volatility points rails. to determine the exit.

Exception Condition:

- The favorable price distance from the latest volatility point must be at least
  `VOLATILITY_THRESHOLD` so the v points is still forming,A new target vPoint does not need to
  be confirmed; the latest available vPoint is the price anchor for this distance
  calculation.
  and we must reenable the traditional TP and stop loss plus.

Definition:

the current `BOTH:VOLATILITY_TARGET_EXIT` is not always in level 0. see the scenario

## Definition

### `BOTH:VOLATILITY_TARGET_EXIT`

The volatility target is direction-based and does not depend on the numeric
vPoint level:

- The next confirmed `TOP` after a `LONG` leg's entry is that leg's target.
- The next confirmed `BOTTOM` after a `SHORT` leg's entry is that leg's target.
- The entry vPoint itself cannot satisfy the target.

When a leg reaches its target, `BOTH:VOLATILITY_TARGET_EXIT` closes only that
favorable leg. The adverse leg remains open and independently evaluates
averaging at the same confirmed vPoint.

After the favorable leg closes, SLOW reopens its role in the direction opposite
the surviving leg. The reopened leg uses the target vPoint as its new anchor,
starts again with the normal base entry margin, and resets its averaging ladder.
The re-entry must still pass the normal entry guards, including
`PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT`.

The closed leg is detached from open positions immediately and its full record
moves to trade history. Until replacement succeeds, its empty MAIN or COUNTER
slot stays visible and shows the exact current reason that role is not open.

Examples from Scenario 1:

- At `TOP[1]-B`, the `LONG` counter leg closes and reopens `LONG`; the `SHORT`
  main leg remains open and may average.
- At `BOTTOM[0]-E`, the `SHORT` main leg closes and reopens `SHORT`; the `LONG`
  counter leg remains open and may average.
- At `BOTTOM[-1]-F`, the reopened `SHORT` main leg closes and reopens again;
  the `LONG` counter leg performs its next averaging step.
- At `TOP[0]-G`, the averaged `LONG` counter leg closes and reopens; the `SHORT`
  main leg remains open and may average.

# B. Conclusions

its like two snake trading in coin.

# C. Updates

## C.1 UI

The open position list will always showing the all coins.

When a leg is not open, its own MAIN or COUNTER card must show the current
role-specific blocking reason inline. Do not make the user open or find another
section. The `Entry Decisions` section may show the same shared diagnostic.

## C.2 Backtest and Quick backtest

It should be updated too

# D. FAQ

1. At every favorable vPoint, should a leg:
   - close,
   - realize profit,
   - immediately reopen not always in the same direction. you see in the scenario the main leg is still opening short, so the the counter leg is opening the oposite right. which is LONG
   - and reset its entry/averaging anchor price to that vPoint? yes

2. Do `MAIN` and `COUNTER` remain fixed from the original pair, or switch roles when the rail changes? For example, at `BOTTOM[0]-E`, is SHORT still `MAIN`, or does LONG become `MAIN`?

on the `BOTTOM[0]-E` the main will close right. but the counter leg is still opening the `LONG` so the main leg will open `SHORT` right doing the oposite.

then the main leg open again short on this point `BOTTOM[0]-E` and TP in `BOTTOM[-1]-F` and then open again in `BOTTOM[-1]-F` and doing averaging because `TOP[0]-G` is their worst vpoint. and so on.

3. After closing an averaged position at its favorable vPoint, does it reopen using the normal base entry margin, resetting its accumulated averaging size?

yes back to the base margin

4. Does the rail exit happen regardless of fee-adjusted PnL, or only when the leg is actually profitable after fees?

its always profit, because the vpoint threshold is 2%.

5. When you say only volatility rails determine exits, should hard stop loss, USDT stop loss, post-average stop loss, and rescue exit also be disabled?

Its "OR" rule, other exit logic might hapen first. (of course except the take profit logic like the TP pct and SL plus because it disabled)

but the reopen should based on the formed vpoint what not been used by some leg.

maybe the case is post averaging rescue exit hapen on their calculation of the target vpoint still forming (drift calculation) so it will exit first then wait until target vpoint is actually formed then open again. ofcourse with considering the guard like `PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT`

6. If a hard stop or USDT stop closes **both legs together**.

modify the stoploss, now it just close some leg that hit the stop loss, it doesnt affecting each other

7. Timing problem

Example:

1. LONG closes at confirmed TOP[1]-B.
2. SLOW wants to reopen LONG using B as its anchor.
3. The current market price is too far from B.price, so PROD:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT blocks entry.
4. While SLOW is waiting, a newer TOP[2]-C becomes confirmed.
   The question is: should LONG still wait for the price to return near B.price, or discard B and use the newer C anchor?

use the newest confirmed unused vPoint which is C

8. What does an “unused vPoint” mean—unused by that specific leg, by that direction, or by either leg?  
   It cannot be globally unused because at `TOP[1]-B`, `SHORT` may use B for averaging while `LONG` also uses B as its new entry anchor.

   unused mean its unused for entry for some leg. i dont care about the averaging

   i think we should introduce something like this

```ts
vpoint.usedByMain = true;
vpoint.usedByCounter = true;
```

9. Should usedByMain or usedByCounter become true only after the entry order succeeds?
   mark only when success place order

10. If both legs are separately closed by other exit rules, there is no surviving leg from which to derive the opposite direction. At the next eligible vPoint, should SLOW restart a fresh two-leg pair using the normal MAIN direction derived from that vPoint?

yes
