# Folder Architecture

This document explains where code lives and why. It describes the current
authoritative structure after the Precision rebuild — one shared runtime
engine, one default Multi strategy, and environment adapters for live,
sandbox, and backtest.

The legacy folders from the pre-Precision codebase are removed. This
repository is the source of truth for Multi behavior.

## 1. The five library roots

All reusable logic lives under `src/lib/` in exactly five roots:

```text
src/lib/
  precision/    # the shared runtime engine — the brain
  production/   # the live/sandbox environment — real time, real fills
  dev/          # the backtest/dev environment — simulated time and fills
  system/       # shared foundation — strategy, storage, notification, MCP
  exchange/     # exchange abstraction and platform clients
```

Dependency direction:

```text
production ─┐
            ├─> precision ──> system ──> exchange
dev        ─┘        ▲            ▲          │
                     └────────────┴──────────┘
                     (production and dev also depend on system + exchange)
```

- `precision` never imports `production`, `dev`, or concrete exchange code.
  It knows only `RuntimeEngineAdapter` and `RuntimeEngineState`.
- `production` and `dev` build environment adapters that plug into the
  engine. They may import `precision`, `system`, and `exchange`.
- `system` is shared and strategy-neutral except `system/trading`, which is
  the default Multi implementation the engine calls directly.
- `exchange` may use `system` services (logging, notification port, storage)
  — for example the Binance request coordinator reports cooldowns and logs
  through them. `system` references exchange types only.
- `system/mcp` may read `production` for live introspection (`engine_state_read`
  runs through `production.runtime`). `production` never imports `mcp`.

## 2. `precision/` — the shared engine

One `RuntimeEngine` drives backtest, sandbox, and live. It owns scheduling,
stage isolation, and the serialized work queue; it never talks to an
exchange or the filesystem.

| Module | Responsibility |
|---|---|
| `RuntimeEngine.ts` | The engine loop: due-stage scheduling, per-stage error isolation, `runExclusive` serialized queue, cycle failure resilience, runtime error records. |
| `monitoring/` | Stage bodies: `entry.ts` (capture-entry), `position.ts` (exit/averaging per position), `schedule.ts` (next-due-time), `stages.ts` (stage table), `manual.ts` (operator passes). |
| `defaultDecision/` | Default Multi decision finders — `entry.ts`, `exit.ts`, `averaging.ts` — call `system/trading` functions and return decisions for the engine to execute. |
| `helper/` | `market.ts` (`updateMarkPrice`, `updateVPointsMap` — vPoint detection over adapter klines), `account.ts`, `types.ts`. |
| `utils/` | `positions.ts` (PnL updates, monitoring-stage classification, `markVPointUsed`), `preview.ts` (state previews). |
| `types.ts` | `RuntimeEngineState`, `RuntimeEngineAdapter`, `RuntimeContext`, decision types. `constant.ts` — cadence defaults. |

The adapter contract (`RuntimeEngineAdapter`) is the environment boundary:

- `clock` — backtest advances a logical clock; production waits on real time.
- `market.getKlines` — the only market-data input, bounded by `currentTime`.
- `exchange` — balance/fee reads.
- `onAction` / `onExit` — execute an approved decision, return the position.
- `onStrategy` — final approval/veto gate for environments that deviate.
- `onStateChange` — persist after mutations (positions, vPoint markers).
- `onNewVPoint`, `onStageStats`, `onCycleComplete`, `onManagement`,
  `onRiskSentinel` — environment-owned stage and persistence hooks.

There is no `RuntimeStrategy` type and no `src/lib/strategy` root. Multi is
the built-in default: `defaultDecision` calls `system/trading` directly and
`onStrategy` remains the arrangement/veto gate.

## 3. `production/` — the live/sandbox environment

Everything specific to real time and real (or sandboxed) exchange access.

| Module | Responsibility |
|---|---|
| `runtime.ts` | `ProductionRuntime`: engine lifecycle, supervisor restart with backoff, `runManual` (serialized operator tasks; falls back to persisted state when the engine is down), `captureState`, `status`. |
| `singleton.ts` | Process-wide runtime owner; dev hot-reload restart. |
| `factory.ts` | `createState` — hydrates positions, balances, and seeds `vPointsMap` from persisted volatility files (`PROD:VPOINTS_BOOTSTRAP_FROM_STORAGE`). `createAdapter` + action handlers — execution, `usedBy` marking, persistence. |
| `stages.ts` | Environment-owned stage bodies: risk sentinel, management (incl. monitor notifications), cycle completion, stage stats, daily PnL/performance state. |
| `execution.ts` | Order execution details through the exchange layer. |
| `clock.ts` | Real-time clock with abort-aware sleep. |
| `manual.ts` | Operator-initiated passes (manual entry/exit/run, diagnostics). |
| `precision-test-case/` | Production capture recorder for Precision Checker replay. |
| `state.ts`, `vpoints.ts`, `types.ts`, `adapter.ts` | State assembly, volatility file persistence, contracts. |

## 4. `dev/` — the backtest/dev environment

Dev-page tooling behind `/dev/*` plus the backtest adapter.

| Module | Responsibility |
|---|---|
| `backtestPrecision/` | Backtest adapter (`api/`), the backtest runner (`backtest/`), and `leaderboards/` (saved configs + metrics under `storage/leaderboards/`). |
| `precisionChecker/` | Case selection, production-period replay, and backtest-vs-production comparison. |
| `black-swan/`, `coins/`, `quick-backtest/` | Dev-page feature libraries. |
| `klines.ts`, `enabled.ts`, `storage-sync.ts` | Dataset loading, dev gate, storage sync helpers. |

The backtest adapter never submits real orders, never sends external
notifications, and never writes live state (`BOTH:SHARED_RUNTIME_ENGINE`
safety rules).

## 5. `system/` — shared foundation

### `system/trading/` — the default Multi strategy

Entry, averaging, exit, reserve, and reporting — strategy-neutral in
placement, Multi in content. Called by `precision/defaultDecision` and
shared by every environment.

| File | Responsibility |
|---|---|
| `entry.ts`, `entry-action.ts`, `entry-sequences.ts` | Decision evaluation, funding plan, symbol sequence ordering. |
| `entry-diagnostics.ts` | Read-only entry-block explanations (`VOLATILITY_POINT_USED`, drift, guards) for the dashboard. |
| `averaging.ts`, `adaptive-averaging.ts` | Averaging signals and adaptive sizing. |
| `exit.ts`, `post-average-rescue.ts`, `post-average-stop-loss.ts`, `level-based-pct-drift-stop-loss.ts`, `late-entry-vpoint-drift.ts` | Exit conditions. |
| `reserve.ts` | Reserve ladder + `vpoints` usage helpers (`isUsed`, `markUsed`, `resetUsage`). |
| `daily-pnl-limit.ts`, `daily-performance.ts`, `black-swan.ts`, `worker-capacity.ts` | Account/portfolio guards and daily aggregates. |
| `pnl.ts`, `position.ts`, `leverage.ts`, `reporting.ts`, `types.ts` | Shared calculations and the canonical `Position` model. |

### `system/storage/` — persistence

`runtime.ts` (status, positions, history, `vpoints` merge/read/resetUsage),
`catalog.ts` (config), `account-state.ts` (account-scoped loads),
`json-file.ts` (atomic writes), `files.ts` (path registry), `logs.ts`,
`notifications.ts`, `balance-snapshots.ts`, `binance-health.ts`,
`instance-ip.ts`, `sanitize.ts`, `root.ts`. Compact JSON, short field
names (`t`, `pct`), atomic updates.

### `system/notification/` — notification port and emitters

`index.ts` — the `systemNotif` port (`central` returns delivery success;
registered by the composition root). `delivery.ts` — Telegram + n8n CRM
email, retry 1+3 @5s, dedupe-on-success, persistent failure log.
`trades.ts`/`monitors.ts`/`management.ts` — emitters for trade, monitor,
and management notifications. `config.ts` — channel/type registry.
`examples.ts` — preview payloads that never send.

### `system/mcp/` — the MCP server

`tools.ts` — tool definitions + permission dispatch. `engine-state.ts` —
live engine introspection. `balance.ts`, `history.ts`, `monitoring.ts`,
`finance-summary.ts` — read tools. `tokens.ts` — token auth/permissions.
`identity.ts` — server name/instructions.

### Remaining `system/` modules

`runtime/` — config normalization, effective account config, stage
metadata, resource monitor, test-case helpers. `queue/` — action queue.
`safehaven/`, `withdrawal/` — scheduled fund features. `dashboard/` —
dashboard state assembly. `logging/` — `systemLog`. `time/` — time
helpers. `utils/` — `vpoints.ts` (detector, `mergeById`, `retainRecent`,
`resetUsage`), `klines.ts`, `format.ts`, caches. `types/` — market and
shared types. `config/` — env helpers. `constants.ts` — shared constants.

## 6. `exchange/` — exchange abstraction

| Module | Responsibility |
|---|---|
| `platform/binance/` | Binance client, `request-coordinator.ts` (global cooldown + `NOTIF_BINANCE_COOLDOWN`), account-scoped API calls. |
| `platform/okx/`, `platform/tokocrypto/` | Other exchange clients. |
| `adapters/` | Per-exchange adapter facades. |
| `account-context.ts` | Per-account runtime context (credentials, client instances). |
| `derivatives-analytics/` | Futures analytics helpers. |
| `fees.ts`, `funding-rate.ts`, `market-cap.ts`, `ensure-closed.ts`, `credentials.ts`, `utils.ts`, `types.ts`, `config.ts`, `constants.ts` | Exchange-domain services and types (`ExchangeType`, `TradingMode`). |

## 7. App surface

| Path | Responsibility |
|---|---|
| `src/instrumentation.ts` | Composition root: registers the notification sender, ensures the catalog, starts the production runtime, IP check, resource monitor. |
| `src/pages/api/` | HTTP surface. `system/` — dashboard ops (manual passes, state, history, queue, withdraw, mcp-tokens, notification-test, precision-test-case). `market/` — klines, volatility (incl. `removeUsed` reset), funding-rates, initialize. `dev/` — backtest-precision, precision-checker. `mcp.ts` — JSON-RPC endpoint dispatching `runtimeMcp` tools. `pin` — auth. |
| `src/app/` | App-router shell: `page.tsx` (dashboard), `dev/`, `pin/`. |
| `src/components/` | `LiveDashboard/` (panels, navbar, settings), `dev/`, `endpoints/` (client call registry mirroring `/api` paths — never hardcode `/api/` literals), `ui/`, `client/`. |
| `src/driver/` | Exchange driver facade for pages needing a single exchange handle. |
| `src/__dev__/` | Test suite — `quality/{unit,specs,ui,precision}`, `e2e`. |
| `storage/` | Runtime data (gitignored) — see `docs/SPECS/TECHNICAL/STORAGE.md`. |

## 8. How one cycle flows

1. `instrumentation.ts` boots: catalog ensured, `systemNotif` sender
   registered, `production.runtime.get().start(factory.create())`.
2. `factory.createState` hydrates positions, balances, and seeds
   `vPointsMap` (with persisted `usedBy` markers) from storage.
3. The engine loop asks `monitoring.schedule` for the next due stage and
   sleeps via `adapter.clock` until then.
4. Each due stage runs serialized: helpers refresh `markPriceMap` /
   `vPointsMap` (new points persist via `onNewVPoint`), monitoring bodies
   evaluate exits/averaging/entries through `defaultDecision` →
   `system/trading`, `adapter.onStrategy` gates, `adapter.onAction`/`onExit`
   executes, results mutate `state.openPositions`/`balance` and mark vPoints.
5. `onStateChange` persists account state and vPoint markers to storage;
   `onStageStats`/`onCycleComplete` record pass stats and stage timing.
6. A throwing stage is caught by `runStage` (logged + recorded, loop
   continues); an engine exit triggers the supervisor restart in
   `production/runtime.ts`.

Backtest follows the identical path with a logical clock, dataset-backed
klines, simulated fills, and isolated run storage.

## 9. Placement rules

- New engine/scheduling behavior → `precision/` (must run identically in
  backtest and production).
- New live/sandbox-only behavior → `production/`.
- New backtest/dev-page tooling → `dev/`.
- New shared strategy rule → `system/trading/`. New shared calculation or
  market utility → `system/utils/`. New persisted file → `system/storage/`
  + a `files.ts` path entry + `docs/TODO/storage.md` inventory.
- New exchange capability → `exchange/` under the platform folder.
- New API route → `src/pages/api/<family>/` + a `components/endpoints/`
  registry entry.
- Grouped APIs over scattered exports; no broad barrel exports; reuse
  existing types before creating new ones.
