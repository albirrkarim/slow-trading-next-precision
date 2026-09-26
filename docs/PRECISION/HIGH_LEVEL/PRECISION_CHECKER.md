# Precision Checker — V1

TC: `BOTH:PRECISION_MEASUREMENT`

for the http://localhost:3010/dev/precision-checker

we trying to compare the live execution of the sandbox mode vs when it reply using the backtest method.

i think we need

in the production

http://localhost:3010/

i need to have record of the initial

```
vPointsMap
```

keep the latest 10 vPoints per symbol, plus every vPoint still required by an open position: points at or after the earliest open entry time and every vPoint referenced by an open position's entry or intermediate vPoint refs.

so the tescase will be like

```ts
import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "src/lib/dev/backtestPrecision/api/precision-api-types.ts";

interface PrecisionTestCase extends BacktestTestCase {
  /**
   * Runtime state captured when the recording ends; absent in the pending
   * file. Unlike `initialState`, `vPointsMap` here is a delta: per symbol,
   * the vPoints newly detected during the recording window plus pre-existing
   * points whose content changed while recording. Reconstruct the full map
   * as `initialState.vPointsMap` overlaid with this delta.
   */
  endState?: PrecisionRuntimeSnapshot;
  /**
   * Exact runtime snapshot taken when the recording started: balances per
   * account, still-open positions, and bounded vPoints (latest 10 per symbol
   * plus every point an open position still needs). The enclosing `startTime`
   * is the canonical snapshot and replay time.
   */
  initialState: PrecisionRuntimeSnapshot;
  tradeHistory: Position[];
}
```

# A. Goal

Measure result precision by comparing final production and backtest position
JSON for equivalent runs. No other precision type is measured in V1.

# B. Production capture

The Production Dashboard provides **Start Production Test Case** and **End
Production Test Case**. The Precision Test Cases dashboard section lists
completed captures and allows deleting an individual file after an explicit
confirmation.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

# C. Test-case JSON

the time start and end is like `dd-mm-yyyy-hh-mm`

```text
storage/persistent/instances/3010/dev/precision-test-case/live-<start>-<end>.json
storage/persistent/instances/3010/dev/precision-test-case/sandbox-<start>-<end>.json
```

TC: `PROD:PRODUCTION_TEST_CASE`

# E. Page `/dev/precision-checker`


I imagine like top section it list the all the production test cases that has been captured. then select it. 
and theres a button run.

after run we got the backtest result right.

Overview section shows the overall precision score.

Then theres two column of 

[production result] [backtest result]

[table history]     [table history]

# F. Metrics

Above the two columns sits the metrics block (`src/lib/dev/precisionChecker/metrics/`,
client-side; the API returns raw data only). `metrics.build(result)` returns
`{ overall, categories }` rendered as colored score cards:

- **Overall precision** — mean of the category scores, equal weight per aspect.
- **Balance**, **Trades**, **Volatility points** — one card each; the card's
  bullet list is the "breakdown why" — every metric line colored by its own
  severity with `prod → bt · diff`.

## Severity and scoring

Divergence is measured on **absolute** difference — a favorable direction still
counts as wrong, because the goal is precision, not profitability.

Each row resolves to `match | minor | major | none` via per-metric bands
(`BANDS` in `metrics/index.ts`): below `minor` = match (green), below `major` =
minor (orange), otherwise major (red), `none` = unscorable.

| Row kind | green | orange | red |
|---|---|---|---|
| Balance \|pct diff\| | <0.5 | <2 | >=2 |
| Counts (trades, vPoints/symbol) | 0 | 1 | >=2 |
| Unpaired leftovers | 0 | <=2 | >=3 |
| Minute diffs | <1 | <5 | >=5 |
| Price pct diffs | <0.05 | <0.25 | >=0.25 |
| Averaging count/pair | <0.25 | <1 | >=1 |
| Exit-reason mismatch | <10% of pairs | <33% | >=33% |
| PnL USDT/pair, Margin/pair | <$0.5 | <$2 | >=$2 |
| PnL pct, Max up/down pct/pair | <0.1pt | <0.5pt | >=0.5pt |

Score per row: match 100, minor 60, major 0, none excluded. Category score =
mean of its row scores; card severity bands at >=90 green / >=60 orange /
else red.

## Balance

- `Balance · {account}` — initial → production end → backtest end totals
  (`initialState.balance`, `endState.balance`, last entry of the backtest
  `balanceSnapshots`), diff `±$x (±y%)`.

## Trades

`Trade history` count diff, then paired evaluation. Trade pairing
(`metrics/trade-pairs.ts`): greedy one-to-one on
`account | symbol | hour(opened.t)` — the nearest unconsumed backtest entry
time inside the bucket wins.

- `Trade pairs` — `paired/total` per side plus unpaired leftover count.
- `Trade entry diff` — mean `|opened.t Δ|` min/pair.
- `Trade exit diff` — mean `|closed.t Δ|` min/pair, both-closed pairs.
- `Duration diff` — mean `|(closed.t−opened.t) Δ|` min, both-closed pairs.
- `Entry price diff` / `Exit price diff` — mean `|price Δ| / prod price × 100`,
  own denominators (pairs with a positive production price).
- `Margin diff` — mean `|exposure.marginUsdt Δ|` USDT/pair.
- `Quantity diff` — mean `|exposure.quantity Δ|` pct of production quantity.
- `Averaging minute diff` — executions zipped by order index, `Σ|t Δ|` min
  divided by trade-pair count.
- `Averaging count diff` — mean `|executions.length Δ|`/pair.
- `Exit reason diff` — pairs whose `closed.reason` differs, `n/pairs`.
- `PnL diff USDT` / `PnL diff %` — mean `|pnl.netUsdt Δ|` / `|netPct Δ|`
  (pct points) per pair.
- `Max up diff` / `Max down diff` — mean `|pnl.maxUpPct Δ|` / `|maxDownPct Δ|`
  per pair — intra-trade path fidelity.

## Volatility points

- `vPoints · {symbol}` — count within `[testCase.startTime, endTime]`, union of
  symbols, zero-count pairs hidden.
- `vPoint pairs` — vPoint pairing (`metrics/pairs.ts`): greedy one-to-one on
  `symbol | lvl | l | hour(t)` (T/B type included so tops never match bottoms);
  nearest unconsumed backtest point in the bucket wins.
- `vPoint minute diff` — `Σ|prod.t − bt.t|` min / pair count.