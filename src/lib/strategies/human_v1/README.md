# human_v1

Trend following on the configured indicator features (`management.indicators`,
Settings → Features). No volatility points, no averaging.

## Entry — `BOTH:HUMAN_V1_ENTRY`

Per configured coin (BTC excluded), each capture pass:

1. Read the **first enabled EMA** instance and every **Supertrend** instance from
   `state.features.coins[coin].ind`.
2. Compare the mark price with the EMA value → side (+1 above, −1 below).
3. A **fresh cross** — the side differs from the side recorded at the previous
   pass (`state.strategy.side`) — **arms** that direction
   (`state.strategy.armed`). The first observation only seeds the memory, so a
   boot never enters mid-trend. A cross back re-arms the other direction.
4. An armed direction enters once the mark is **at least 1% beyond the EMA**
   that way (`HUMAN_V1_MIN_EMA_DISTANCE_PCT`) **and every Supertrend** points
   the same way (all `d === 1` for a LONG, all `d === −1` for a SHORT). The arm
   is consumed by the entry.

No EMA, no Supertrend, or still warming up → no entry. Size: fixed
`amountProbab` 0.5. Shared protections still apply: enabled account with
balance, max open positions, configured coin, no shorts in spot, auto-remove
minimum price, one active position per coin.

The entry signal is a synthetic vPoint-shaped object (`id: H_<COIN>_<t>`) so
the shared execution path sizes and records it; it never marks a real vPoint
used. The position stores `strategy.logic = { v: "human_v1", emaId }`.

## Exit — `BOTH:HUMAN_V1_EMA_EXIT`

1. Every shared exit rule runs first (TP, SL, max hold, …). Rules built on
   vPoint data (level-based drift stop, exit on vPoint level, volatility-target
   TP/SL) are meaningless here — disable them in the account's trading config.
2. Otherwise a human_v1 position closes when the mark crosses back over its
   EMA (LONG below, SHORT above), recorded as `STRATEGY_EXIT`.

## Averaging — `BOTH:HUMAN_V1_NO_AVERAGING`

Never. Set the account's averaging reserve (`watchReserveLevels`) to 0 so entry
sizing does not hold back margin for averagings that never happen.
