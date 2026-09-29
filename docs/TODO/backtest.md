I plan to add mcp tools that triggering the backtest 

so AI agent like you can doing backtest 

what do you think it should look like 

my current human workflow is 
using the page  

http://localhost:3010/dev/backtest-precision

1. Input Menu

2. run backtest

3. see the metrics + see sort what trades that resulting most big loss usd on the pnl final

4. thinking i need to adjust this

5. adjust the config.


6. run backtest again


7. is it better ? when better so save to the leaderboards


# Important things to consider is 

- The coin must using: MON, AAVE, SUI, LINK because i already testing their volatility points

- The config must like rubber it elastic not over fitting, because the market might have anomaly.

# MCP design

The backtest loop is already API-shaped; the MCP layer only exposes it:

- run: `src/lib/dev/backtestPrecision/api/run.ts` → deterministic `cacheKey` → chunked artifacts
- lazy reads: `api/detail.ts` (`field=positions|vpoints|snapshots`, offset/limit)
- leaderboards: `leaderboards/store.ts` (id = hash of backtestConfig + cacheKey)
- registry: `src/lib/system/mcp/tools.ts` — per-token permissions, `WRITE_TOOL_NOTICE` on writes

## Tools

| Tool | Hint | Maps to | Notes |
|---|---|---|---|
| `backtest_config_template` | read | input menu | Returns the dashboard's current `BacktestTestCase` (catalog-derived) + per-symbol data coverage (first/last non-empty day). Agent clones + mutates. Coverage reporting prevents silent range clipping — MON data starts 2025-10-10, so a `2year` run including MON effectively starts there (`Math.max` intersection in `backtest/data.ts`). |
| `backtest_precision_run` | write | run backtest | `{config, range \| startTime+endTime, upToDateKlines?}` → `{cacheKey, status}`. **Async** — a multi-year run takes minutes; MCP timeouts would cut a sync call. Cache dedupe makes identical params return the finished result for free. |
| `backtest_run_status` | read | poll | `{cacheKey}` → `running \| done \| failed \| interrupted` + `summary`. Detect order: `dirFor(key)/meta.json` = done → `.failed/<key>.json` = failed (records `{t, error}`, written by `run.ts` on catch before staging cleanup) → staging dir matching `<key>-*` = running, or **interrupted** when its mtime is stale (process died before the marker write). Must report **effective dataset start/end** so symbol clipping is explicit. |
| `backtest_result_read` | read | metrics + biggest losses | `{cacheKey, field, sort, order, offset, limit}` — detail endpoint already paginates; add server-side `sort=pnlUsdt&order=asc` so "worst trades" is one call. |
| `backtest_runs_list` | read | "is it better?" | Lists recent cache metas (range, symbols, summary) — compare trials without re-running. |
| `backtest_result_metrics` | read | evaluate before saving | `{cacheKey}` → `BacktestLeaderboardMetrics`. **Missing today**: `meta.json` only stores the coarse `summary`; the full metric set is derived on demand — currently the leaderboard POST fuses compute+save into one step, so there's no preview without committing. This tool runs `metrics.compute(backtestResultCache.read(cacheKey))` and returns metrics without saving. |
| `backtest_leaderboard_save` / `_list` / `_delete` | write | save to leaderboards | Input `{cacheKey, label?}` — wraps `api/leaderboards.ts` POST, which recomputes metrics from the cached artifacts and persists `storage/leaderboards/<id>.json`. |

Permissions on the existing token system: `backtest.read`, `backtest.run`, `backtest.leaderboard.write`. Write tools carry `WRITE_TOOL_NOTICE`.

## Elastic / non-overfit usage contract

The tools are neutral; the anti-overfitting discipline is in how the agent uses them:

- A config earns a leaderboard save only if it wins on multiple ranges (`6month`, `1year`, `2year`) — not one lucky window.
- Sensitivity check: perturb the tuned parameter ±20–30%; result must stay positive. Elastic = plateau, not peak.
- Reject "improvements" on small samples (`counts.positions` < ~30 → noise).
- Tune physical knobs only (drift %, funding windows, leverage/margin caps, profit-securing) — no magic constants; meaningful thresholds degrade gracefully on anomalies.

## Caveats

- Failure detection is implemented: `run.ts` writes `.failed/<cacheKey>.json` (`{t, error}`) on catch and clears it when a fresh attempt starts; a successful publish leaves none. Still open for `run_status`: a killed *process* can't write the marker — detect it as a staging dir with stale mtime (interrupted, not running).
- Runs share CPU with the production engine — run on the dev instance or while paused; note it in the tool description.
- Backtest tools only exist when `devBacktest.isEnabled()` — same gate as the page.
- `config_template`'s coverage scan needs a non-downloading per-symbol first/last-day reader over the dataset dir (bounds today are computed inside `prepareSymbolDays` while downloading).
- Cut order: `config_template` + `run`/`status` + `result_read` first (closed loop), leaderboards after.
