# Strategy Idea — Low-Level Harvesting with Cross-Account Cover

Directive for AI agents iterating on this repo's backtest. The MCP server is
`precision-trading-localhost` (all `backtest_*` tools + engine-state reads).

## A. Goal

Produce profit **every day** by harvesting low-level volatility (levels 0-2)
with `VOLATILITY_THRESHOLD = 2%` — shallow waves are the most frequent events
in the stream, so they give the daily cadence.

When a wave runs deep (high |lvl|), account 1 **stops adding** and account 2
puts on a position that covers account 1's floating losses, then profits on
the recovery. The core mechanic is **averaging distributed across accounts**.

## B. Constraints — physics an agent must respect

- `lvl` is signed: BOTTOM points are negative, TOP points positive. Observed
  max |lvl| on AAVE over a 2-year run: **5 both directions**. Size for the
  tail you haven't seen, not the tail you measured.
- **Symbols are fixed: MON, AAVE, SUI, LINK** — their vPoints are the tested
  set. Do not add or swap coins; a different symbol is a different experiment.
- Minimum margin per entry is **~$6 on Binance** — that is the real equity
  floor. `minEquity ≈ legsToSurvive × $6 × buffer`.
- Cross-account cover is **correlated averaging**, not a hedge — both
  accounts hold the same coin. If the wave continues past the handoff, both
  books draw down together.
- "Daily profit" means daily *realized* cadence; deep waves pin capital.
  Judge runs by `emptyBalance` (dry spells) + floating drawdown, not by
  counting green days.

## C. Optimization target

**Minimum equity to run** — sum of enabled accounts' initial balances
(`settings.accounts[].sandbox.initialBalanceUSDT` where `enabled`). Lower is
better *as long as drawdowns stay survivable*. The leaderboard has a
sortable "Min Equity" column; a winning entry is green on Min Equity **and**
low on Floating DD — cheap but fragile does not count.

Balance split between accounts is a design choice: harvester small, cover
account sized for the deep tail.

## D. Strategy interface

Existing modules under `src/lib/strategies/<slug>`, selected by
`management.strategy`:

- `default` — built-in pipeline (no strategy field = this)
- `both` — paired MAIN/COUNTER legs, opposite-direction re-entry
- `streak` — pair strategy with sibling-based re-entry

An agent may author its own strategy as `custom_<agent_slug>_<name>_v1` (e.g.
`custom_swe_2_ladder_cover_v1`, `custom_gpt6_sol_wave_pairs_v1`). The slug must
equal the folder name. Read `src/lib/strategies/types.ts` + an existing module
(streak is the most complete) for the contract before writing one.

**README required.** Every `custom_*` folder ships a `README.md` matching
`both/` and `streak/` style: what the strategy does in plain terms, the
handoff level rule it encodes (entry side + cover side), which config knobs
it reads, and why the author expects it to hit the goal. Other agents read
the README to decide whether a strategy is worth running before spending a
backtest slot on it.

**Do not touch the shared test file.** Never add a `custom_*` slug or its
cases to `src/__dev__/main/quality/unit/strategies.test.ts` — a hardcoded
agent slug there makes one agent's experiment load-bearing in everyone's
suite (if the folder is later removed, `strategies.resolve` tests break).
`strategies.test.ts` currently carries `custom_gpt6_astra_ladder_cover_v1` —
that is the pattern to NOT repeat. If your strategy needs tests, give it its
own file under `src/__dev__/main/quality/unit/`.

**Registration — a new folder alone is NOT loadable.** The resolver is a
static map (`strategies/index.ts`), not a filesystem scan. Two edits make a
slug resolve:

1. `src/lib/strategies/types.ts` — add the slug to the `StrategySlug` union.
2. `src/lib/strategies/index.ts` — add `loaders["<slug>"] = () => import("./<slug>")`.

Unregistered slugs fail loudly ("Unknown strategy slug") rather than silently
falling back to default.

**Hot reload** — each `backtest_precision_run` forks a fresh `tsx` worker
(`api/worker-client.ts`), so new/changed strategy code takes effect on the
next run with no server restart; the registry edit itself recompiles under
Next dev. The same is true on the live engine only at engine start — the
backtest gets the new code immediately, production gets it on restart.

The open decision the strategy encodes: **the handoff level** — where account
1 stops and account 2 enters (e.g. acct1 harvests |lvl| ≤ 2, acct2 opens at
|lvl| ≥ 3), and whether acct2's position is same-direction rescue or
opposite-direction cover. This boundary is where the PnL lives — treat it as
the primary tunable, not a footnote.

## E. Procedure — the agent loop

1. `backtest_config_template` — current config + per-symbol data coverage.
   Check coverage: a late-listed symbol clips the whole run's range.
2. `backtest_precision_run` — returns `{cacheKey}` immediately; poll
   `backtest_run_status` until `done` (watch `dataset` — the *effective*
   window after symbol intersection). **One run at a time**: identical params
   join the in-flight run; a different run while one is active returns
   `status: "busy"` with the occupying `cacheKey` — poll it and retry rather
   than racing parallel simulations.
3. `backtest_result_metrics` — preview leaderboard metrics without saving.
4. `backtest_result_read` — `field=positions`, `sort=pnl.netUsdt`,
   `order=asc` → biggest losers first. `field=vpoints name=MON` for a
   symbol's full point map (`sort=lvl` for level extremes).
5. `backtest_trade_inspect` — the chart data for one trade (1m klines,
   markers, vPoints in window; `padDays` 0-30, default 7).
6. Adjust config (handoff level, margins, balance split, entry filters) →
   re-run → `backtest_runs_list` + `result_metrics` to compare trials.
7. `backtest_leaderboard_list` — pull the existing saved entries **before**
   saving. The board is a scoreboard, not an archive: only save a run that
   **beats the existing entries** — higher gain/monthly at equal-or-lower
   Min Equity and Floating DD, or equal metrics at strictly lower Min
   Equity. A new entry must advance the frontier, not just add a row. Match
   range when comparing (a 6month run does not beat a 1year entry).
8. `backtest_leaderboard_save` — accepts `{cacheKey, label}`. The label is
   your attribution: **prefix it with your agent slug and say what changed**,
   e.g. `swe_2 lvl2-handoff 350+500` or
   `gpt6_sol custom_gpt6_sol_wave_pairs_v1`. A label without an agent name is
   an anonymous entry — nobody can tell who earned it.

## F. Elastic / no-overfit rules

A config earns a leaderboard save only if it:

- wins on **multiple ranges** (`6month`, `1year`, `2year`) — not one lucky
  window;
- stays positive under **±20-30% perturbation** of the tuned parameters —
  elastic is a plateau, not a peak;
- has enough samples — reject improvements on **< ~30 closed positions**;
- tunes **physical knobs** (levels, margins, leverage caps, funding windows,
  profit-securing) — not arbitrary magic constants.