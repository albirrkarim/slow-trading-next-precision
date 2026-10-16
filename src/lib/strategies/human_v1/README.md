# human_v1

Supertrend-alignment trading on the configured indicator features
(`management.indicators`, Settings → Features). No volatility points, no
averaging. Needs at least one EMA (the first enabled one is used, e.g.
EMA 200 · 4h) and one or more Supertrends (tuned on 12×3, 10×1, 11×2 · 4h).

## Entry — `BOTH:HUMAN_V1_ENTRY`

Per configured coin (BTC excluded), each capture pass reads the first EMA
and every Supertrend from
`state.features.coins[coin].ind`. A coin has a setup when:

1. **Every Supertrend points the same way and flipped together**: the
   oldest and newest flip times (`fT`) are at most
   `HUMAN_V1_FLIP_WINDOW_MS` (1 day) apart, so the flips line up vertically
   on the chart.
2. **The alignment is fresh**: the newest flip is at most that same window
   old.
3. **At least two lines collide**: the two closest Supertrend lines are at
   most `HUMAN_V1_COLLIDE_PCT` (1.25%) of the mark apart. Checked on every
   pass while the alignment is fresh, so lines that ratchet into each other
   after the flip still count.
4. **Price is above the EMA.**

Each alignment (keyed by its newest flip time) is traded at most once
(`state.strategy.used`).

The direction follows the Supertrends (all up → LONG, all down → SHORT);
both need price above the EMA. The SHORT is the "stretched above EMA 200"
setup: the Supertrends turn down while price still sits above the EMA. No
entry when price is below the EMA.

| | Level |
|---|---|
| SL | the slowest Supertrend line (farthest from price: lowest for a LONG, highest for a SHORT) |
| TP | entry ± `HUMAN_V1_TP_R` (2) × the entry→SL distance |

### Why these numbers

Research over 16 coins × 3 years (2023-10 → 2026-10, 4h Supertrends and
EMA, exits replayed on 1h candles, SL first when both hit in one hour,
0.1% fees), all with flips ≤ 1 day apart and price above the EMA:

| Rule | Trades | Win | Avg R |
|---|---|---|---|
| Earlier EMA / VWAP-band exits, no collide | 460 | 53% | −0.15 |
| Slowest-line SL, 2R, no collide | 449 | 37% | +0.06 |
| Slowest-line SL, 2R, collide ≤ 1% | 54 | 52% | +0.52 |
| **Slowest-line SL, 2R, collide ≤ 1.25%** | **82** | **48%** | **+0.42** |
| Slowest-line SL, 2R, collide ≤ 1.5% | 118 | 42% | +0.22 |

The edge comes from the collision and fades smoothly as it loosens;
1.25% trades a little edge for 50% more trades than 1%.

The TP and SL go onto the entry decision as `plan` and are stored on the
position as `strategy.plan` (`BOTH:STRATEGY_PLAN_EXIT`). No timeout is set.

Size: fixed `amountProbab` 0.5. Shared protections still apply: enabled
account with balance, max open positions, configured coin, no shorts in
spot, auto-remove minimum price, one active position per coin.

The entry signal is a synthetic vPoint-shaped object (`id: H_<COIN>_<t>`) so
the shared execution path sizes and records it; it never marks a real vPoint
used. The position stores `strategy.logic = { v: "human_v1", emaId }`.

## Exit

The default exit producer: the position's plan (`PLAN_TP` / `PLAN_SL`) plus
every shared exit rule (TP %, SL %, SL USDT, SL Plus, …). Rules built on
vPoint data (level-based drift stop, exit on vPoint level, volatility-target
TP/SL) are meaningless here, so disable them in the account's trading config,
and widen `takeProfitPercent` / `stopLossPercent` if the plan should decide.

## Averaging — `BOTH:HUMAN_V1_NO_AVERAGING`

Never. Set the account's averaging reserve (`watchReserveLevels`) to 0 so entry
sizing does not hold back margin for averagings that never happen.
