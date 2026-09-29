# Backtest MCP tools — design

I plan to add MCP tools that trigger the backtest, so an AI agent can do the backtest loop itself.

My current human workflow uses the page `http://localhost:3010/dev/backtest-precision`:

1. Input menu
2. Run backtest
3. See the metrics + sort which trades produced the biggest USD loss on final PnL
4. Think about what to adjust
5. Adjust the config
6. Run backtest again
7. Is it better? When better, save to the leaderboards

Constraints:

- The coins must be MON, AAVE, SUI, LINK — I already tested their volatility points.
- The config must be elastic — not over-fitted, because the market can have anomalies.

# A. Design

The backtest loop is already API-shaped; the MCP layer only exposes it:

- run: `src/lib/dev/backtestPrecision/api/run.ts` → deterministic `cacheKey` → chunked artifacts
- lazy reads: `api/detail.ts` (`field=positions|vpoints|snapshots`, offset/limit)
- leaderboards: `leaderboards/store.ts` (id = hash of backtestConfig + cacheKey)
- registry: `src/lib/system/mcp/tools.ts` — per-token permissions, `WRITE_TOOL_NOTICE` on writes

## A.1 Tools

| Tool | Hint | Maps to | Notes |
|---|---|---|---|
| `backtest_config_template` | read | input menu | Returns the dashboard's current `BacktestTestCase` (catalog-derived) + per-symbol data coverage (first/last non-empty day). Agent clones + mutates. Coverage reporting prevents silent range clipping — MON data starts 2025-10-10, so a `2year` run including MON effectively starts there (`Math.max` intersection in `backtest/data.ts`). |
| `backtest_precision_run` | write | run backtest | `{config, range \| startTime+endTime, upToDateKlines?}` → `{cacheKey, status}`. **Async** — a multi-year run takes minutes; MCP timeouts would cut a sync call. Cache dedupe makes identical params return the finished result for free. |
| `backtest_run_status` | read | poll | `{cacheKey}` → `running \| done \| failed \| interrupted` + `summary`. Detect order: `dirFor(key)/meta.json` = done → `.failed/<key>.json` = failed (records `{t, error}`, written by `run.ts` on catch before staging cleanup) → staging dir matching `<key>-*` = running, or **interrupted** when its mtime is stale (process died before the marker write). Must report **effective dataset start/end** so symbol clipping is explicit. |
| `backtest_result_read` | read | metrics + biggest losses | `{cacheKey, field, sort, order, offset, limit}` — detail endpoint already paginates; add server-side `sort=pnlUsdt&order=asc` so "worst trades" is one call. |
| `backtest_runs_list` | read | "is it better?" | Lists recent cache metas (range, symbols, summary) — compare trials without re-running. |
| `backtest_trade_inspect` | read | diagnose one trade | `{cacheKey, tradeId, padDays?}` → the same dataset the trade-chart dialog renders, so the agent sees exactly what the chart shows. See A.2. |
| `backtest_result_metrics` | read | evaluate before saving | `{cacheKey}` → `BacktestLeaderboardMetrics`. **Missing today**: `meta.json` only stores the coarse `summary`; the full metric set is derived on demand — currently the leaderboard POST fuses compute+save into one step, so there's no preview without committing. This tool runs `metrics.compute(backtestResultCache.read(cacheKey))` and returns metrics without saving. |
| `backtest_leaderboard_save` / `_list` / `_delete` | write | save to leaderboards | Input `{cacheKey, label?}` — wraps `api/leaderboards.ts` POST, which recomputes metrics from the cached artifacts and persists `storage/leaderboards/<id>.json`. |

The `summary` returned by `run`/`status`/`runs_list` already covers the results page's aggregate sections as JSON — `summary.accounts[]` = the "Total PNL per account" table (slug, start, end, pnlUsdt, gainPct, wins, losses), `summary.exits[slug]` = the exit-reason and profit/loss-coin histograms (`profit`, `loss`, `profitCoins`, `lossCoins` — `{reason, count}` buckets). No dedicated chart tool needed; pies are visualization only.

## A.2 `backtest_trade_inspect` payload

Mirrors `TradeChartDialog` for one trade, but **cropped for MCP payload efficiency** — every candle costs agent context tokens:

- **Window** — `opened.t − padDays` → `closed.t + padDays`, where `padDays` is a tool **param** (default `7`, min `0`, max `30`). `0` returns just the trade span for cheap checks; widen only when the pre-entry trend matters. (The dialog pads ±30d via `TRADE_CHART_CONTEXT_MS` — too heavy for a default tool response.)
- **Position** — entry/exit, `pnl.history`, averaging executions, `strategy.logic` role + `pairId`, `blockReason`-style context.
- **Klines** — 1m candles inside the window, re-read from `storage/datasets/PRECISION_BACKTEST/1m` via `getKlines`. Not stored in the run cache — a later `upToDateKlines` refresh can shift the tail slightly; fine for diagnosis.
- **Markers** — every trade marker inside the window, not just this trade's: sibling legs (`MAIN leg ENTRY`, `COUNTER leg EXIT`), `AVG` fills, `Avg Entry` line — same set `buildTradeMarkersFromHistory` produces.
- **Volatility points** — the symbol's vPoints filtered to the window (the `BOTTOM[-2]`/`TOP[+1]` labels), so the agent sees which level was hit and whether `usedBy` consumed it.
- **Levels** — entry-level lines (L-2…L-6) and exit reference, matching the chart's horizontal guides.

## A.3 Permissions

On the existing token system: `backtest.read`, `backtest.run`, `backtest.leaderboard.write`. Write tools carry `WRITE_TOOL_NOTICE`.

## A.4 Access guard — localhost instance only

- Backtest tools stay **visible in `tools/list` on every instance** — the agent should be able to discover them — but `tools/call` is gated server-side by `isDevBacktestEnabled()` (`src/lib/dev/enabled.ts`), the same env gate that 404s `/dev/*` pages and `/api/dev/*` routes: `NODE_ENV !== "production" || ENABLE_DEV_BACKTEST === "1"`.
- On a gated (production/remote) instance the call returns a **warning payload, not an error**: `{warning: "Backtest tools are only available on the local dev instance — connect to the localhost MCP endpoint."}` so the agent knows to switch instances instead of retrying.
- Mechanism: optional gate on `RuntimeMcpToolDefinition` — e.g. `devOnly?: boolean` or `gate?: () => string | null`; `tools.call` consults it before dispatching and returns the warning as a normal tool result. The tool description also notes the localhost requirement so agents see it at `tools/list` time.
- Token permissions still apply on top — a gated warning only fires for a token that actually holds the permission.

## A.5 Elastic / non-overfit usage contract

The tools are neutral; the anti-overfitting discipline is in how the agent uses them:

- A config earns a leaderboard save only if it wins on multiple ranges (`6month`, `1year`, `2year`) — not one lucky window.
- Sensitivity check: perturb the tuned parameter ±20–30%; result must stay positive. Elastic = plateau, not peak.
- Reject "improvements" on small samples (`counts.positions` < ~30 → noise).
- Tune physical knobs only (drift %, funding windows, leverage/margin caps, profit-securing) — no magic constants; meaningful thresholds degrade gracefully on anomalies.

# B. Caveats

- Failure detection is implemented: `run.ts` writes `.failed/<cacheKey>.json` (`{t, error}`) on catch and clears it when a fresh attempt starts; a successful publish leaves none. Still open for `run_status`: a killed *process* can't write the marker — detect it as a staging dir with stale mtime (interrupted, not running).
- Runs share CPU with the production engine — run on the dev instance or while paused; note it in the tool description.
- `config_template`'s coverage scan needs a non-downloading per-symbol first/last-day reader over the dataset dir (bounds today are computed inside `prepareSymbolDays` while downloading).
- Scope: `backtest-precision` only; `quick-backtest` is a different runner and stays out unless needed.
- Cut order: `config_template` + `run`/`status` + `result_read` first (closed loop), leaderboards after.
