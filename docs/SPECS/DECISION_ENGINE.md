# v20

Decision v20 is the direct level-entry engine intended for scalping. It does
not use Speed Tier metadata, latest-kline projection, projected entry timing,
or estimated exit timing.

For every symbol except BTC, v20 should return the latest volatility point when
the point is unused and:

`abs(level) >= config.minActionableAbsoluteLevel`

The configured minimum uses the same default `2` and minimum `1` normalization
as v19. Every qualifying candidate is returned in the current cycle; v20 does
not wait for a lower-level projection and does not select only one candidate by
estimated exit speed. Existing worker-capacity, position, funding, reserve,
market-mode, and execution guards still run after the engine recommendation.
Existing recommendation sizing and leverage semantics remain unchanged.

TC: `BOTH:DECISION_V20_LEVEL_GATE`
