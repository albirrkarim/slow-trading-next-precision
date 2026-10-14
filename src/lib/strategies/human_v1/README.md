# human_v1

Supertrend-alignment trading on the configured indicator features
(`management.indicators`, Settings → Features). No volatility points, no
averaging. Needs at least one EMA (the first enabled one is used, e.g.
EMA 200 · 4h), one or more Supertrends, and the monthly VWAP (`vwap`).

## Entry — `BOTH:HUMAN_V1_ENTRY`

Per configured coin (BTC excluded), each capture pass reads the first EMA,
the monthly VWAP price and σ, and every Supertrend from
`state.features.coins[coin].ind`. A coin has a setup when:

1. **Every Supertrend points the same way and flipped together**: the
   oldest and newest flip times (`fT`) are at most
   `HUMAN_V1_FLIP_WINDOW_MS` (1 day) apart, so the flips line up vertically
   on the chart.
2. **The alignment is fresh**: the newest flip is at most that same window
   old.
3. **The lines collide at the flip**: the highest and lowest Supertrend line
   are at most `HUMAN_V1_MAX_LINE_SPREAD_PCT` (3%) of the mark apart on the
   first pass that sees the alignment. If they are further apart, that
   alignment is skipped for good, even if the lines converge later.
4. **Price is above the EMA.**

Each alignment (keyed by its newest flip time) is judged once and traded at
most once (`state.strategy.used`).

Then, by the Supertrend direction:

| Setup | SL | TP | Extra check |
|---|---|---|---|
| LONG (all up) | EMA value | VWAP + 1.5σ | TP above the mark |
| SHORT (all down) | VWAP + 1σ | VWAP − 1.5σ | TP below the EMA, SL above the mark |

The SHORT is the "stretched above EMA 200" setup: the Supertrends turn down
while price still sits above the EMA, targeting a move back through it.
No entry when price is below the EMA.

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
