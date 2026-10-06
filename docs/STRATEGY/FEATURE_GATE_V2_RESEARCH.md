# Feature Gate V2 research — 6 October 2026

The implemented gate achieved the requested historical target on the supplied
five-year dataset: **641 closed trades, 641 winners, zero losses, and zero open
positions at the end**. Account PnL increased from **704.72 to 1,339.34 USDT**.
The original and final replays used identical parameters and fixed timestamps.

Four additional entry regimes reject all nine original losing entry snapshots
while retaining 620 snapshots in the preliminary screen. The complete engine
replay produced 641 trades because entry vetoes change later trading
opportunities and entry timing. Every saved final position was independently
checked for a closing record and strictly positive net PnL; the smallest
recorded net profit was 0.607 USDT. The strategy files on disk match the replay's
saved source hash (`bd2d9e2dba995dc0267c4457b0033fe06dce23d7db46cc8d0f9855e9ee332b78`).

These results are fitted to the supplied dataset. The separate other-symbol
run still lost money, so this result does **not** establish a reliable future
or other-symbol 100% win rate.

## Data and execution

- Source cache: `storage/cache/backtest-precision/c641dc191a3dcad0c5ed927ef80e99645c14a580637fdb602d1a0c49416e3b8f`.
- Fitted symbols: ADA, ETH, HBAR, SOL, XLM; BTC supplies market context.
- Fixed dataset window: 7 October 2021 12:15 UTC to 6 October 2026 12:15 UTC.
- The engine consumes its usual 60-day warm-up before trading.
- Account 1 starts with 350 USDT; other accounts remain disabled as saved.
- Detector configuration: 5% volatility threshold, 1% pivot retrace.
- Experiments use `precisionBacktest`, including the normal Black Swan sentinel,
  fee calculations, position execution, averaging, funding, and exits.
- Artifacts are written to fresh directories under `storage/research/feature-gate`.
  The research driver pins timestamps, checks local candle coverage, refuses
  existing output directories, and records the strategy source hash.

## Completed measurements

| Run | Closed trades | Winners | Losses | Win rate | Account PnL, USDT | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original gate, supplied symbols | 665 | 656 | 9 | 98.65% | +704.72 | 0 |
| Implemented gate, supplied symbols | 641 | 641 | 0 | 100.00% | +1,339.34 | 0 |
| Original gate, other symbols | 123 | 118 | 5 | 95.93% | −178.01 | 0 |
| Implemented gate, other symbols | 122 | 117 | 5 | 95.90% | −179.69 | 0 |

The other-symbol runs use AAVE, LINK, SUI, XRP from 4 October 2023 00:00 UTC
to 6 October 2026 00:00 UTC, with the same warm-up and saved trading settings.
All their entries finish during 2024. At the final balance of 170.31 USDT,
the shared funding calculator refuses a 10-USDT entry: after funding the entry
and its 20-USDT reserve, only 140.31 USDT remains versus the required
180-USDT unreserved bailout buffer. The later empty years
therefore do not establish successful trading coverage. The implementation does not
improve the loss count in this comparison.

The fitted run's trade counts by entry year were:

| UTC entry year | Original trades | Implemented trades | Implemented losses |
| --- | ---: | ---: | ---: |
| 2021 | 20 | 20 | 0 |
| 2022 | 211 | 204 | 0 |
| 2023 | 66 | 62 | 0 |
| 2024 | 178 | 174 | 0 |
| 2025 | 145 | 138 | 0 |
| 2026 | 45 | 43 | 0 |

Even the all-winning fitted run has substantial adverse movement. Its worst
recorded per-position unrealized loss was **102.846 USDT** on an XLM position
opened 19 March 2022; that position eventually closed with 13.656 USDT profit.
The longest holding period was approximately **650.77 hours (27.1 days)**.
A historical count of winning exits does not describe the capital needed to
survive those paths.

## Entry features

All inputs are available in the runtime feature store at the decision tick.
The gate reads no eventual position PnL, closing reason, future candle, date
whitelist, or symbol whitelist.

| Regime | Entry veto |
| --- | --- |
| Failed breakout | Coin maximum over the last three normalized changes > 1.1, and current normalized value ≤ 0.85. |
| Spent upward excursion with weak BTC | Signal `maxUpPct` > 3.5%, and BTC minimum over its last three normalized changes ≤ 0.1. |
| Recent breakdown with limited BTC envelope | Coin normalized value touched ≤ 0 within 24 hours, and BTC monthly VWAP `stretchPct` ≤ 10%. |
| Quiet BTC with a coin at an extreme | BTC monthly VWAP `stretchPct` ≤ 4%, and coin current normalized value ≤ 0.05 or > 0.95. |

Normalized values locate the latest pivot inside the price envelope of earlier
pivots over roughly two months. Their histories contain value changes, so
“last three” means three changes rather than three candles. The existing VWAP
and 12-hour signal-age checks still run before these regime checks.

Missing inputs do not count as zero. Regime history reads exclude timestamps
beyond the current tick and nonfinite values. The filter is pure and uses the
same strategy producer and diagnostic path in backtest, sandbox, and live.
Persisted feature and position schemas are compatible because the filter only
reads existing fields.

## Why the first candidate was rejected

An initial rule vetoed a normalized downward impulse of at least 0.1 when the
signal's observed upward excursion was at most 1%. It screened out five
original losers, but its engine replay entered ADA on 14 August 2022 at 20:25
UTC instead of the original 19:20 UTC. The small additional bounce cleared the
veto; the position still lost approximately 122.86 USDT on 26 August.

That replay was stopped after the failure. The second candidate uses failed
breakout history and quiet-market extreme checks to cover these conditions
without clearing the veto merely because the mark bounced slightly.

## Interpretation and limits

The thresholds were selected using the entire supplied dataset. Its per-year
results are descriptive; those years cannot be presented as independent
validation. The other-symbol comparison was performed after freezing the
second candidate, but shares market dates and BTC context with the fitting
set. It is a test of symbol transfer, not an independent future period.

A perfect fitted historical win rate cannot establish a future 100% win rate.
The observed other-symbol losses show this limitation directly. Exploring many
feature conditions also creates selection bias; see Bailey et al.,
[The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).
No probability of backtest overfitting or formal statistical significance was
estimated in this experiment.

## Reproduce the current implementation

Use a fresh run name each time. This runs the implementation currently on disk,
so the saved `research.policyHash` identifies the source used by that run.

```sh
npx tsx -r tsconfig-paths/register src/driver/feature-gate-research.ts \
  storage/cache/backtest-precision/c641dc191a3dcad0c5ed927ef80e99645c14a580637fdb602d1a0c49416e3b8f \
  rerun-fitted

npx tsx -r tsconfig-paths/register src/driver/feature-gate-research.ts \
  storage/cache/backtest-precision/c641dc191a3dcad0c5ed927ef80e99645c14a580637fdb602d1a0c49416e3b8f \
  rerun-other-symbols AAVE,LINK,SUI,XRP 2023-10-04T00:00:00Z 2026-10-06T00:00:00Z
```

The original and candidate exploration scripts and compact policies are saved
locally under `storage/research/feature-gate`. The completed implementation replays are `final-v2` and `final-unseen-v2`;
the original replays are `baseline` and `unseen-baseline`. Full replay results
use the normal chunked `positions`, `features`, `vpoints`, and `snapshots` artifact format.

## Code verification

`npm run type` passed. `npm run quality` passed: lint, TypeScript, and 733 tests
across 124 test files. Tests cover the regime boundaries, missing and invalid
evidence, future timestamps, the delayed-entry regression, input immutability,
VWAP/freshness compatibility, and producer/diagnostic behavior in all three
runtime modes. Behavioral specification: `BOTH:FEATURE_GATE_REGIMES`.
