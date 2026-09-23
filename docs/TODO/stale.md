# Stale Spec / Marker Audit

Findings from the cross-spec TC audit (`docs/SPECS/`) after the Precision
rebuild. `BOTH:` means the behavior must exist in backtest AND production;
`PROD:` means production runtime only (live and/or sandbox).

## Documented but not implemented in any mode

- [ ] `BOTH:SAFE_HAVEN_QUEUE` + `PROD:WITHDRAW_QUEUE` +
  `PROD:SAFE_HAVEN_SCHEDULE_QUEUE` (RUNTIME.md) — audited: the queue is
  write-only. `system/queue` persists items and the dashboard renders them, but
  nothing in `production/` processes them: no scheduled pass calls
  `isDue`/`executeSchedule`, `balance.safeHavenRequest` is never consumed,
  `autoEnabled` is never evaluated, and `lastAttemptAt`/`nextAttemptAt` are
  never updated. `runtimeWithdrawal.schedules.execute` bypasses the queue
  entirely (manual API only, 2 USDT cap). The dashboard copy claiming "the
  production runner checks pending work every five minutes" is false. Decision
  needed: implement the queue-processing stage, mark the spec sections as
  planned, or remove them as legacy. If kept, `BOTH:SAFE_HAVEN_QUEUE` should
  also become `PROD:` (spec text scopes it to "live and sandbox modes").

## `PROD:` markers on code that is actually shared — resolved

- Relabeled to `BOTH:` in docs and source: `GLOBAL_VOLATILITY_THRESHOLD`,
  `SPEEDUP_STAGE_SHARED_VOLATILITY_CLASSIFICATION`, `MONITORING_OPEN_POSITION`,
  `TRADE_HISTORY_EXIT_MONITORING_STAGE`, `TRADE_HISTORY_ACCOUNT_CHIP`,
  `TRADE_HISTORY_JSON_TREE`, `MULTI_ACCOUNT_SHARED_MARKET_PREPARATION`,
  `MULTI_ACCOUNT_SEQUENTIAL_ACCOUNT_EXECUTION`,
  `MULTI_ACCOUNT_PRIVATE_STATE_ISOLATION`, `ATOMIC_PERSISTENT_JSON`,
  `CANONICAL_POSITION_STORAGE`. Each was verified running in the shared
  precision path (or shared UI/storage) in backtest before relabeling.
- Kept `PROD:` deliberately: `SPEEDUP_STAGE` / `STANDARD_MONITORING_STAGE`
  (RUNTIME.md, BINANCE.md). The stages run in backtest, but the marked
  paragraphs describe production-only mechanics — independent wall-clock
  timers, pre-execution storage reload, serialized mode-state persistence,
  `stageRuns` records, and the Binance request coordinator's overlap rules.

## Implemented but missing source markers

- [ ] `BTEST:BACKTEST_VOLATILITY_DATASET`, `BTEST:BACKTEST_MARKET_TYPE` —
  implemented in `src/lib/dev/backtestPrecision/backtest/data.ts` +
  `storage/datasets/PRECISION_BACKTEST/`; no markers.
- [ ] `BOTH:BALANCE_AVAILABLE` / `BALANCE_SPENDABLE` / `BALANCE_RESERVED` /
  `BALANCE_LOCKED` / `BALANCE_SAFE_HAVEN` — updated in shared
  `monitoring/position.ts` + `entry-action.ts`; no markers.

## Verified correct as `PROD:` (no change)

- All `BINANCE_*` (exchange cooldowns, request coordinator, balance budgets),
  all `NOTIF_*` (notifications never fire in backtest), all LOGGING TCs,
  `AUTO_REMOVE_*` (management-stage), `FUTURES_*`,
  `SYNC_ENTRY_POSITION_FROM_EXCHANGE`, `CONFIRM_FUTURES_EXIT_ON_EXCHANGE`,
  `MCP_*`, `RUNNER_BOOTSTRAP_ON_SERVER_START`,
  `CYCLE_PERFORMANCE_SECTION_DURATION`, `EMPTY_MONITORING_NO_MARKET_IO`,
  `QUICK_BACKTEST_VISIBLE_VPOINTS` (dashboard sim, not the precision backtest),
  `ENTRY_DECISION_DIAGNOSTICS`, `AVAILABLE_ENTRY_WORKERS`,
  `WORKER_NEEDED_ESTIMATION`, `VOLATILITY_INCREMENTAL_PERSISTENCE`,
  `DASHBOARD_PERSISTED_BALANCE`, `MANUAL_ACCOUNT_BALANCE_REFRESH`,
  `MONITORING_POSITION_FUNDING_RATE`, `OPEN_POSITION_FUNDING_RATE_UI`,
  `MULTI_ACCOUNT_DAILY_BALANCE_SNAPSHOTS`, `SYNC_ONLINE_TO_LOCAL`,
  `HISTORY_CONFIG_INDEPENDENT`, `TRADE_HISTORY_NOTES`, `INSTANCE_IP_STORAGE`,
  `NAVBAR_INSTANCE_IP_COPY`,
  `OPEN_POSITION_STALE_MONITORING_WARNING`, `DAILY_PNL_META_TITLE`,
  `MULTI_ACCOUNT_TRADING_CONFIG_SUMMARY`, `MULTI_ACCOUNT_TRADING_NOTES`,
  `HISTORICAL_ENTRY_SEQUENCES`, `VPOINTS_FREQUENCY`, `VPOINTS_LEVEL_MAX_DD`,
  `SAME_VOLATILITY_POINT`, `LATEST_VOLATILITY_*`, `MARKET_CAP_*`,
  `STAGE_RUN_STATS`, `SLOW_RUNTIME_MEMORY_LEAN`, `TOTAL_ASSET`,
  `TRADING_ENTRY_LIVE_PREVIEW`, `TRADING_ACCOUNT_SCOPED_LIVE_PREVIEW`,
  `AUTO_REMOVE_MARKET_CAP_INPUT_PREVIEW`, `BLACK_SWAN_*` (evidence capture +
  account fan-out are production stage concerns; the shared engine only reads
  the protective flag through `onStrategy`).
