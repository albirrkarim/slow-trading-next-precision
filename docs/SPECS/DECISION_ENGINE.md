# Multi strategy entry gate

Multi is the system's default strategy, implemented directly in
`src/lib/system/trading/` — there are no versioned decision engines anymore;
`decisionEngineVersion` in config is only a display label. This section
records the entry-gate rule formerly known as decision v20.

The Multi entry gate is the direct level-entry rule intended for scalping. It
does not use Speed Tier metadata, latest-kline projection, projected entry
timing, or estimated exit timing.

For every symbol except BTC, the gate returns the latest volatility point when
the point is unused and:

`(minEntryAbsLevel === undefined || abs(level) >= minEntryAbsLevel)`

and

`(maxEntryAbsLevel === undefined || abs(level) <= maxEntryAbsLevel)`

Both bounds are inclusive. New accounts start with `minEntryAbsLevel = 2`
and no maximum. Clearing either field disables that bound; `0` is an active
bound, so `maxEntryAbsLevel = 0` allows only absolute level `0` (unless the
minimum excludes it). A maximum below the minimum yields no candidates.
Every qualifying candidate is returned in the current cycle; the gate does
not wait for a lower-level projection and does not select only one candidate
by estimated exit speed. Existing worker-capacity, position, funding,
reserve, market-mode, and execution guards still run after the gate's
recommendation. Recommendation sizing and leverage semantics remain
unchanged.

TC: `BOTH:DECISION_V20_LEVEL_GATE`
