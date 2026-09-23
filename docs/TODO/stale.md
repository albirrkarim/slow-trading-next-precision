# Stale Spec / Marker Audit

Findings from the cross-spec TC audit (`docs/SPECS/`) after the Precision
rebuild. `BOTH:` means the behavior must exist in backtest AND production;
`PROD:` means production runtime only (live and/or sandbox).

## Divergences: implemented in production only, should be shared

- [x] `AUTO_ENTRY_DAILY_PNL_LIMIT_USDT` (RUNTIME.md) — fixed: the backtest
  adapter's `onStrategy` now evaluates `runtimeDailyPnlLimit` over the run's
  closed-position history, mirroring production's `isActionAllowed` veto.
  Manual forced entries stay exempt. Marker relabeled to `BOTH:`.

## Wrong `BOTH:` markers (never run in backtest)

- [ ] `BOTH:SAFE_HAVEN_QUEUE` (RUNTIME.md) — the spec text itself scopes it to
  "live and sandbox modes"; the withdrawal/safe-haven queue never runs in
  backtest. Should be `PROD:`.
- [ ] `BOTH:VOLATILITY_LEVEL_SYNC_THROTTLE` (RUNTIME.md) — documented level-
  distance kline sync throttle (6h / 4h / 5min by distance from
  `minActionableAbsoluteLevel`) has NO implementation anywhere — no
  `lastSync`/level-distance sync code exists. Either implement or mark the
  section as planned.

## `PROD:` markers on code that is actually shared (should be `BOTH:`)

- [ ] `GLOBAL_VOLATILITY_THRESHOLD` — `VOLATILITY_THRESHOLD` env drives shared
  logic (late-entry drift cap, adaptive-averaging target) in backtest too.
- [ ] `SPEEDUP_STAGE`, `STANDARD_MONITORING_STAGE`,
  `SPEEDUP_STAGE_SHARED_VOLATILITY_CLASSIFICATION`, `MONITORING_OPEN_POSITION` —
  classification + exit-first monitoring pass live in
  `src/lib/precision/monitoring/` and run per-candle in backtest
  (`lastMonitoringStage` is persisted on backtest positions). Only the
  wall-clock interval scheduling is production-specific.
- [ ] `TRADE_HISTORY_EXIT_MONITORING_STAGE`, `TRADE_HISTORY_ACCOUNT_CHIP`,
  `TRADE_HISTORY_JSON_TREE` — shared `PositionLevelSequence` / trade dialog
  render these in the backtest report too.
- [ ] `MULTI_ACCOUNT_SEQUENTIAL_ACCOUNT_EXECUTION`,
  `MULTI_ACCOUNT_PRIVATE_STATE_ISOLATION`,
  `MULTI_ACCOUNT_SHARED_MARKET_PREPARATION` (CYCLE.md) — the shared
  `RuntimeEngine` iterates accounts with isolated per-account state over one
  shared market snapshot in every mode.
- [ ] `ATOMIC_PERSISTENT_JSON` (STORAGE.md) — `jsonFile.write.atomic` is the
  shared primitive; backtest cache writes use it too.
- [ ] `CANONICAL_POSITION_STORAGE` (STORAGE.md) — the canonical position JSON
  shape is exactly what the backtest cache persists.

## Implemented but missing source markers

- [ ] `BTEST:BACKTEST_VOLATILITY_DATASET`, `BTEST:BACKTEST_MARKET_TYPE` —
  implemented in `src/lib/dev/backtestPrecision/backtest/data.ts` +
  `storage/datasets/PRECISION_BACKTEST/`; no markers.
- [ ] `BOTH:BALANCE_AVAILABLE` / `BALANCE_SPENDABLE` / `BALANCE_RESERVED` /
  `BALANCE_LOCKED` / `BALANCE_SAFE_HAVEN` — updated in shared
  `monitoring/position.ts` + `entry-action.ts`; no markers.
- [ ] `BOTH:VOLATILITY_LEVEL_SYNC_THROTTLE` — missing impl AND marker.

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
  `NAVBAR_INSTANCE_IP_COPY`, `SAFE_HAVEN_SCHEDULE_QUEUE`, `WITHDRAW_QUEUE`,
  `OPEN_POSITION_STALE_MONITORING_WARNING`, `DAILY_PNL_META_TITLE`,
  `MULTI_ACCOUNT_TRADING_CONFIG_SUMMARY`, `MULTI_ACCOUNT_TRADING_NOTES`,
  `HISTORICAL_ENTRY_SEQUENCES`, `VPOINTS_FREQUENCY`, `VPOINTS_LEVEL_MAX_DD`,
  `SAME_VOLATILITY_POINT`, `LATEST_VOLATILITY_*`, `MARKET_CAP_*`,
  `STAGE_RUN_STATS`, `SLOW_RUNTIME_MEMORY_LEAN`, `TOTAL_ASSET`,
  `TRADING_ENTRY_LIVE_PREVIEW`, `TRADING_ACCOUNT_SCOPED_LIVE_PREVIEW`,
  `AUTO_REMOVE_MARKET_CAP_INPUT_PREVIEW`, `BLACK_SWAN_*` (evidence capture +
  account fan-out are production stage concerns; the shared engine only reads
  the protective flag through `onStrategy`).
