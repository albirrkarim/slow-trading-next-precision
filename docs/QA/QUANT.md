# Quant Comparison

Scope: how close PRECISION is to what professional quantitative traders do,
across engineering discipline, risk management, alpha research, and
validation rigor. Reviewed against the implemented system — `docs/SPECS/`,
`src/lib/precision/`, `src/lib/system/trading/`, `src/lib/dev/backtestPrecision/`.

**Overall: infrastructure ~70% of a small prop shop; alpha research ~20%.**

PRECISION is a fully systematic crypto-perp bot — volatility-pivot (TOP/BOTTOM)
mean-reversion entries, guarded DCA/averaging, layered exits, margin-bucket
sizing. That places it between "automated retail strategy" and "single-strategy
quant desk". The engineering practices are genuinely quant-grade; the
alpha side is a hand-designed heuristic, not a statistically discovered edge.

## Score breakdown

| Area | Closeness | Notes |
|---|---|---|
| Rule-based execution | Equal | Deterministic decisions, no discretion anywhere in the pipeline |
| Backtest↔live parity | Equal | One shared `precision` engine for backtest/sandbox/live; `BOTH:` TCs enforce identical behavior — many small funds do this worse |
| Risk limits & kill switches | Close | Daily-PnL stop, max positions, liquidity-aware sizing, black-swan sentinel, reserve accounting |
| Accounting rigor | Close | Fee-aware PnL, funding snapshots, exchange-as-source-of-truth reconciliation, confirmed futures exits |
| Metrics / evaluation loop | Close | Sharpe, win rate, drawdown ranges, bear-window resilience, capital efficiency; leaderboards = config comparison |
| Alpha research | Weak | Fixed heuristic (pivots + averaging); no statistical edge discovery, no expected-value modeling |
| Validation protocol | Weak | No walk-forward / out-of-sample split; leaderboard comparisons on one window invite selection bias |
| Portfolio construction | Out of scope | One position per symbol, independent; no correlation or multi-strategy layer |
| Strategy diversity | Out of scope | One family: mean-reversion + averaging |
| Latency / execution infra | N/A | 1–5 min cycles — a different, honest niche; not competing for queue position |

## Strengths (verified in code)

- **Shared engine across modes** — `src/lib/precision/` drives backtest,
  sandbox, and live. `BOTH:` test markers enforce identical behavior in sim
  and prod. This is the single most expensive thing real shops build and the
  most common place they fail; PRECISION has it.
- **Spec-driven change control** — `docs/SPECS/` + TC markers
  (`BOTH:`/`BTEST:`/`PROD:`) document required behavior per mode, mirroring
  production change-control at prop desks.
- **Risk layer is real, not decorative** —
  `runtime.autoEntryDailyPnlLimitUSDT` pauses auto-entry on UTC-day net loss,
  `maxOpenPositions` caps exposure, `maxEntryBased24HourVolPct` is the same
  %-of-volume liquidity constraint institutional desks use, balance is split
  into spendable/reserved/locked/safeHaven buckets.
- **Reconciliation discipline** — live monitoring syncs position size/margin
  from the exchange (`PROD:SYNC_ENTRY_POSITION_FROM_EXCHANGE`), treats the
  exchange as source of truth, and confirms futures closes on-exchange with
  reduceOnly + residual sweep (`PROD:CONFIRM_FUTURES_EXIT_ON_EXCHANGE`).
- **Honest measurement** — leaderboard metrics include monthly-return Sharpe,
  per-position floating drawdown extrema (`pnl.maxDown*`),
  `bearMarketProofRatio` for regime resilience, and capital-efficiency
  (locked-turnover) scores. These are the right things to measure for a DCA
  system.

## Gaps vs. quant practice

- **No alpha research pipeline.** The edge is designed (pivot threshold,
  averaging ladder), not discovered. Quants spend most effort estimating
  *whether* a signal predicts anything; PRECISION's effort went into *how* to
  execute and protect it. There is no expected-value model per entry —
  decisions are deterministic thresholds, not forecast-weighted.
- **No out-of-sample discipline.** Leaderboards rank configurations on the
  same backtest window they were tuned on. Best config on one window ≈ best
  fit to that window's noise. Quant standard: tune on period A, report only
  period B.
- **Single payoff shape.** Entries + averaging produce short-volatility
  convexity: many small wins, occasional large losses. One family, one bet —
  no uncorrelated strategies to smooth the equity curve.
- **No portfolio layer.** Positions are independent per symbol; nothing
  accounts for correlated crypto drawdowns beyond the black-swan breadth
  detector (which is the right seed for this).

## The core concern: averaging tail risk

Martingale-flavored averaging is the pattern quants are most skeptical of,
because the win rate looks great right up until it doesn't. PRECISION's guards are
unusually thorough — adaptive multipliers with rescue-profit projection
(`BOTH:ADAPTIVE_AVERAGING`), stop-after-target-vPoint
(`BOTH:AVERAGING_STOPS_AFTER_TARGET_VPOINT`), level caps, black-swan forced
exits — but the payoff shape remains: **the left tail is the strategy's
defining risk, and it must be measured, not assumed away.**

The leaderboard already exposes the evidence: compare
`maxFloatingDrawdownUsdt` / `maxPortfolioDrawdown` against cumulative profit.
If one worst-case averaging sequence erases months of gains, the config's win
rate is misleading.

## Which is "better"?

Wrong axis — different games. Institutional quant stacks cost millions and
hunt alphas retail cannot reach (latency, fee tiers, queue position, borrow).
For personal capital on crypto perps, PRECISION's niche — slow swing
mean-reversion that large firms ignore — is one of the few places retail can
plausibly hold edge. A retail bot with quant-grade plumbing and a modest real
edge beats a quant stack you can't afford.

The correct question is not "am I as good as a quant" but **"is my edge
positive net of costs, across regimes, out of sample?"** The tooling to
answer that already exists; what is missing is the protocol.

## To close the gap (prioritized)

1. **Walk-forward validation** — tune on range A, evaluate on untouched
   range B, promote only configs that hold up. Cheap to add on top of the
   existing precision backtest + leaderboard.
2. **Tail accounting** — report worst averaging sequence PnL vs. cumulative
   profit per leaderboard entry; make the left tail a first-class metric
   alongside Sharpe.
3. **Cost sensitivity** — run configs at 1x / 2x fee + funding assumptions;
   at 1–5 min cadence with frequent averaging, costs decide whether the edge
   is real.
4. **Regime split** — evaluate the same config in bull, bear, and chop
   windows separately (`bearMarketProofRatio` is a start).
5. **Entry expectancy** — estimate per-vPoint-level expectancy from
   historical signal→outcome pairs; if a level has no positive expectancy,
   the execution layer cannot save it.
