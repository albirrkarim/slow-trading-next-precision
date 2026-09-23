# `src/lib` Cleanup Plan

## Decision

Do **not** reorganize the legacy folders by moving them into new folders. That
would mostly preserve the same coupling under cleaner names.

Do **not** delete legacy folders yet. They remain available as the behavioral
reference while the new Precision architecture is completed.

Instead, build small, straightforward APIs that match the Precision runtime,
then wire the ground-truth modules to those APIs. Legacy code is detached one
dependency at a time. Deletion happens later and only with explicit approval.

This repository is already copied from the Multi instance. **Do not look back
at `slow-trading-next-multi`.** This repository is the source of truth for the
existing Multi behavior.

## Ground truth

These existing folders are the ground truth:

```text
src/lib/exchange
src/lib/dev
src/lib/precision
src/lib/production
```

This new folder also becomes ground truth:

```text
src/lib/system
```

Final authoritative roots:

```text
src/lib/
  exchange/
  precision/
  production/
  dev/
  system/
```

There is no `src/lib/strategy` or `src/lib/system/strategy` root. Multi is the
built-in default strategy of the precision system, so its functions are
dissolved into the homes they semantically belong to: decision/execution
functions into `src/lib/system/trading`, the generic vPoint detector into
`src/lib/system/utils`, and position bookkeeping into `src/lib/precision/utils`.
The runtime contract has no `RuntimeStrategy` type: the engine calls those
functions directly, and `RuntimeEngineAdapter.onStrategy` remains the
arrangement/veto gate for environments that need to deviate from the default
behavior.

Everything else under `src/lib` is a **legacy quarry**. It may be inspected to
preserve required behavior, but new ground-truth code must not depend on it.

## Current inventory

| Folder | Role today | Decision |
|---|---|---|
| `exchange/` | Exchange contracts, adapters, and platform clients | Keep; detach from legacy logging/trading types |
| `precision/` | New shared `RuntimeEngine`, monitoring, actions, helpers | Keep; detach from `brain`, `dynamic`, `slowTrading`, and old `trading` |
| `production/` | Production clock, state, factory, adapter, recorder | Keep; rebuild dependencies through clean ports |
| `dev/` | Precision backtest and Precision Checker | Keep; all dev-page libraries belong here |
| `strategy/` | Removed — was an empty placeholder | Dissolved into `system/trading` + `system/utils` + `precision/utils`; Multi is the default strategy, not a separate root |
| `slowTrading/` | Legacy production runtime, persistence, stages, queue, reporting | Legacy quarry; do not move or delete yet |
| `dynamic/` | Legacy backtest, dynamic types, NN, price norm, vPoint implementation | Legacy quarry; do not move or delete yet |
| `brain/` | Versioned legacy decisions and execution | Legacy quarry; do not move or delete yet |
| `trading/` | Legacy/shared models and execution accounting | Legacy quarry; create clean equivalents only as required |
| `devBacktest/` | Old dev tools and non-goal pages | Legacy quarry; do not move; rebuild required dev behavior under `dev/` |
| `evaluate/` | Old leaderboard analysis | Legacy quarry; rebuild under `dev/` only if still required |
| `datasets/` | Legacy/shared market-data helpers | Legacy quarry; expose only required clean market-data APIs |
| `notification/` | Notification delivery and dedupe | Legacy quarry; create clean `system/notification` API |
| `runtime/` | Instance IP and resource monitoring | Legacy quarry; rebuild required infrastructure under `system` |
| `env/` | Dev-backtest environment flag | Legacy quarry; replace with clean system configuration if required |

Non-goals from `docs/PRECISION/_PRECISION.md` remain excluded:

- Price-normalization features.
- NN features.
- Dynamic legacy types as a model foundation.
- Old decision versions v12–v19.
- `/dev/coins`.
- `/dev/black-swan`.

## Current dependency contamination

The selected ground-truth folders are conceptually correct, but they still
import legacy modules directly. Current direct-import baseline:

| Ground-truth folder | Direct legacy imports found | Main dependencies |
|---|---:|---|
| `exchange/` | 25 | old `trading` logger, notification helper, and `InitialBalance` type |
| `precision/` | 26 | `dynamic`, `brain`, `slowTrading`, old `trading`, `datasets` |
| `production/` | 14 | `slowTrading` storage/balance/types, old `trading`, `dynamic`, `datasets` |
| `dev/` | 15 | `dynamic`, `slowTrading`, old `trading`, `datasets`, `env` |

The goal is not merely different paths. The goal is **zero imports from legacy
folders inside every ground-truth root**.

## Target structure

```text
src/lib/
  system/                         # shared, strategy-neutral foundation
    types/
      account.ts
      market.ts                   # Kline and market-data values
      money.ts
      position.ts

    trading/
      accounting.ts
      execution.ts
      fees.ts
      order-intent.ts
      position.ts
      types.ts

    storage/
      files.ts
      json-file.ts
      types.ts

    notification/
      dedupe.ts
      types.ts
      index.ts

    logging/
    time/
    validation/
    config/

    runtime/
      engine.ts                   # shared runtime contract: adapter, context, state, decisions
      types.ts                    # runtime config types
      test-case.ts                # precision test-case snapshot contracts

    strategy/                     # the default Multi strategy, dissolved into system
      vpoints.ts                  # canonical vPoint stream + batch detection
      entry.ts                    # v20 entry decision scan
      entry-action.ts             # simulated entry execution
      averaging.ts                # watch/averaging decisions + execution
      exit.ts                     # exit decision model + simulated close
      positions.ts                # PnL, monitoring stage, vPoint usage markers
      reserve.ts                  # shared reserve ladder math
      index.ts                    # grouped `strategy` object consumed by the engine

  exchange/                       # exchange implementations and contracts
    adapters/
    platform/
    types.ts
    index.ts

  precision/                      # environment-neutral shared runtime
    RuntimeEngine.ts
    action/
    monitoring/
    ports/                        # clock, market, execution, persistence, monitoring
    helper/
    types.ts

  production/                     # live/sandbox implementations of Precision ports
    clock.ts
    market.ts
    execution.ts
    storage.ts
    notification.ts
    monitoring.ts
    factory.ts
    precision-test-case/

  dev/                            # anything supporting dev pages
    backtest-precision/
    precision-checker/
    test-case/
    evaluate/                     # only if still required
```

Names may be adjusted while designing each API, but the ownership and
dependency direction below are fixed.

## Dependency rules

```text
system      -> no dependency on precision, production, dev, or legacy
exchange    -> system only
precision   -> system only
production  -> system + exchange + precision
 dev         -> system + exchange + precision
```

`precision` owns the engine contract (`precision/types.ts`: `RuntimeContext`,
`RuntimeEngineAdapter`, `RuntimeEngineState`, `RuntimeClock`, decisions).
`system/runtime` keeps the persisted config family (`RuntimeConfig`,
`RuntimeAccountConfig`, `RuntimeManagementConfig`, `RuntimeControlConfig`)
because `system/storage` owns catalog persistence. There is no injected
strategy port: `RuntimeEngine` calls the dissolved default functions directly,
and `adapter.onStrategy` is the gate where environments approve, veto, or
arrange decisions.

The default-strategy functions in `system/trading` consume `RuntimeContext`
and the decision types, so they type-import `precision/types`. That is the
one permitted upward edge — type-only, erased at runtime; no `system` module
may import precision *values*.

Forbidden in all new ground-truth code:

```text
precision   -> slowTrading | dynamic | brain | old trading
production  -> slowTrading | dynamic | brain | old trading
 dev         -> slowTrading | dynamic | brain | old trading
exchange    -> old trading helpers
system      -> any legacy folder
```

Legacy code may temporarily import new APIs while callers are rewired. New code
must never import legacy modules back, because that recreates the dependency
cycle.

Code outside `src/lib` (pages, API routes, components, workers) must eventually
import only the authoritative roots. It must not bypass them to reach legacy
folders directly.

## API boundaries

### `system`

Contains the shared foundation: the persisted config contract
(`system/runtime`), the default-strategy trading primitives
(`system/trading`), generic market utilities (`system/utils`), storage,
logging, time, and domain types. Every module stays small, reusable, and
strategy-neutral — `system` must not know about production, sandbox,
backtest, dashboard pages, or SLOW runtime orchestration.

Examples:

- Stable domain values: `Position`, `Kline`, `VolatilityPoint`, money/account
  identifiers.
- Trading primitives: order intents, execution results, fee/accounting helpers.
- Storage primitives: atomic JSON operations and storage interfaces.
- Notification contracts and global dedupe primitives.
- Logging, time, validation, and configuration utilities.

Do not copy giant legacy types into `system`. Introduce the smallest type an
actual clean API needs.

### `precision`

Owns the shared runtime and environment-neutral orchestration. It receives all
environment behavior through ports:

- Clock.
- Market data.
- Execution.
- Persistence.
- Notifications.
- Monitoring.

Strategy behavior is not a port. The engine calls the dissolved default
functions directly; `adapter.onStrategy` is only the approval gate before an
action runs. Precision must not load files, instantiate exchanges, send
notifications, or reimplement strategy rules inside orchestration code.

### Default strategy homes (no `strategy` root)

The default Multi strategy is dissolved by concern:

- `system/trading/{entry,averaging,exit,entry-action,reserve}.ts` — the
  decision and simulated-execution functions, plus shared reserve math. These
  are trading primitives whose signatures consume the precision engine
  contract.
- `system/utils/vpoints.ts` — the generic vPoint detector (predictor memory,
  kline processing, batch detection, `mergeById`, `retainRecent`). A
  strategy-neutral market utility.
- `precision/utils/positions.ts` — position bookkeeping owned by the engine:
  PnL updates, monitoring-stage classification, `markVPointUsed`.

Reinvent the **API and structure**, not verified behavior. Required vPoint and
Multi calculations should be transferred from this repository and protected by
characterization tests. Do not import the legacy implementation from the new
homes; otherwise legacy remains part of the runtime.

The existing vPoint algorithm is behavioral source material, but batch and
incremental processing share one canonical clean processor so backtest,
sandbox, and live cannot diverge.

### `production`

Implements Precision ports for live and sandbox:

- Real clock and scheduling.
- Exchange-backed market data.
- Exchange-backed execution.
- Persistent storage.
- Notification delivery.
- Runtime monitoring and production test-case recording.

It composes `RuntimeEngine` with the default system strategy; it does not
contain strategy rules.

### `dev`

Contains everything used by dev pages, including Precision backtest and
Precision Checker. Backtest must compose the same `RuntimeEngine` and default
system strategy, replacing only environment adapters.

Old dev tools are not moved wholesale. Required capabilities are rebuilt
against clean APIs; non-goal pages remain in legacy code until deletion.

## Clean migration plan

### Phase 0 — freeze legacy structure

- [ ] Do not move legacy folders.
- [ ] Do not delete legacy folders.
- [ ] Do not add new features to legacy code unless required to fix a current
      production correctness bug.
- [ ] Do not add compatibility shims that let new modules import legacy barrels.

### Phase 1 — define clean contracts

- [x] Audit the exact state and adapter data required by `RuntimeEngine`.
- [x] Create minimal `system/types` and `system/trading` contracts.
- [x] Define Precision ports for clock, market, execution, storage,
      notification, and monitoring.
- [x] Keep types environment-neutral and strategy-neutral.
- [ ] Add dependency-boundary enforcement so authoritative roots cannot import
      legacy paths.

### Phase 2 — detach `precision`

- [x] Replace `dynamic` market/vPoint types with clean types.
- [x] Replace `slowTrading` symbol, schedule, reserve, monitoring, and position
      dependencies with Precision-owned behavior or ports.
- [x] Replace `brain` default decisions with the default system strategy.
- [x] Replace old `trading` models/actions with `system/trading` contracts.
- [x] Finish with zero legacy imports in `src/lib/precision`.

### Phase 3 — dissolve the default strategy (no `strategy` root)

- [x] Dissolve `src/lib/strategy/multi` and then `src/lib/system/strategy`:
      decision/execution functions into `system/trading`, the vPoint detector
      into `system/utils`, position bookkeeping into `precision/utils`. There
      is no `RuntimeStrategy` port — the engine calls the functions directly
      and `adapter.onStrategy` stays the arrangement gate.
- [x] The engine contract (`RuntimeContext`, `RuntimeEngineAdapter`,
      `RuntimeEngineState`, `RuntimeClock`, decisions) lives in
      `precision/types`; the persisted config family stays in
      `system/runtime` for `system/storage`.
- [x] Add characterization tests for required Multi behavior before transfer.
- [x] Implement one canonical vPoint stream processor shared by batch and
      incremental operation (`system/utils/vpoints.processKline` +
      `detectVPoints`).
- [x] Transfer current Multi entry, averaging, exit, and decision behavior
      into `system/trading`.
- [x] Do not transfer NN, price norm, dynamic legacy types, or old decision
      versions.
- [x] Finish with zero legacy imports in the dissolved modules.

### Phase 4 — detach `production`

- [x] Build clean production implementations of every Precision port.
- [x] Recreate only required persistence APIs under `system/storage` and the
      production storage adapter.
- [x] Preserve the approved `prod/` and `dev/` persistent-storage layout.
- [x] Wire live and sandbox through the same RuntimeEngine + Multi strategy path.
- [x] Finish with zero legacy imports in `src/lib/production`.

### Phase 5 — detach `dev`

- [x] Wire Precision backtest to the same RuntimeEngine + Multi strategy path.
- [x] Wire Precision Checker and production test-case replay to clean contracts.
- [x] Rebuild only dev capabilities still present in approved pages.
      Approved set = `/dev/backtest-precision`, `/dev/precision-checker`,
      and LiveDashboard Quick Backtest — all rebuilt on the new
      architecture (`dev/backtestPrecision`, `dev/quick-backtest`, clean
      `api/dev/precision-checker|backtest-precision` routes). Rejected for
      Phase-7 deletion, not ported: `/dev/backtest-vrails` (DynamicTrade UI
      + `api/dev/dynamic-trade/*`), coin tags (`components/dev/Coins/*`,
      `api/dev/coin-tags|coins`, `api/slow-trading/coin-metadata`, the two
      coin-metadata debug routes, `api/mcp.ts` tag handlers →
      `devBacktest/coins`), black-swan preview (`api/dev/black-swan`,
      `api/slow-trading/black-swan-preview`, `Backswan/*` settings
      components → `devBacktest/black-swan`), `components/dev/Evaluation/*`
      dashboards, and `components/api/production/utils.ts` (consumed only
      by quarry code/tests).
- [x] Finish with zero legacy imports in `src/lib/dev`.

### Phase 6 — detach `exchange` and application callers

- [x] Replace exchange imports of the old trading logger, notification helper,
      and balance types with `system` APIs.
- [x] Rewire pages, API routes, components, and workers to authoritative roots.
      Done: `components/storage.ts` delegates to `storageFiles` (one path
      registry), `tradeLog`→`systemLog` across app code, PrecisionChecker's
      `datasets` edge removed. Clean dashboard read model landed:
      `system/dashboard` rebuilds `RuntimeDashboardState` (same response
      shape as `SlowTradingDashboardState`) over `runtimeStorage`, with
      per-account realtime enrichment (live balance, floating PnL, Binance
      health, instance IP). `runtimeStorage.catalog` covers config/accounts
      load/ensure/save/update plus account lifecycle (deleteState,
      resetSandbox); `system/runtime` owns stages, account-config split,
      defaults, and normalizers; `system/trading` owns reporting and
      black-swan. Rewired routes: `storage`, `history`, `logs`,
      `binance-cooldown-reset`, `balance-snapshots`, `exchange-accounts`,
      `reset`, `balance-refresh`, `black-swan`, `queue`, `withdraw`,
      `mcp-tokens`, `mcp`, `notification-test`, and `dashboard/*`;
      `instrumentation.ts` seeds the catalog and checks the instance IP
      through system modules. Components and dashboard types migrated to
      runtime/system shapes (`RuntimeDashboardState`,
      `RuntimeAccountTradingConfig`, `RuntimeEffectiveConfig`,
      `RuntimeSettingsConfig`). System ports added:
      `system/notification/delivery` (delivery engine), `system/queue`
      (items CRUD over catalog), `system/mcp` (tokens + tool dispatch +
      storage read-model backends; tag/coin-metadata tools register from
      `devBacktest` until they relocate), `system/withdrawal` (schedule +
      executor), and `system/trading` gained `entry-sequences`,
      `worker-capacity`, `market-volume`, `leverage`, `position`,
      `post-average-stop-loss`, `post-average-rescue-exit`,
      `level-based-pct-drift-stop-loss`, `adaptive-averaging`,
      `late-entry-vpoint-drift`, and vPoint usage tracking in `reserve`.
      Run stats producers landed: the engine dispatches all five declared
      stages in `RUNTIME_STAGE_ORDER` — `risk-sentinel` and `management` are
      environment-owned optional adapter hooks (`onRiskSentinel`,
      `onManagement`) implemented by `production/stages.ts` and skipped by
      backtest adapters. `risk-sentinel` runs two-pass Black Swan detection
      (BTC drawdown first, breadth fan-out only on warning), persists
      `status.blackSwan`, marks `control.forceExit` on policy-selected
      positions through the shared monitor, and notifies transitions.
      `management` upserts per-account daily balance snapshots, evaluates
      the combined live+sandbox daily-PnL entry stop into
      `status.dailyPnlLimitState`, and sends the completed-day performance
      report once per channel (`status.dailyPerformanceNotified`,
      `status.dailyPnlLimitNotified`). Every stage reports measured
      `stageRuns` stats via `onStageStats` and the tick summary via
      `onCycleComplete` into `status.lastRun*`. The production
      `onStrategy` gate now blocks entries and averaging while Black Swan
      protection is active (including manual entries, matching the legacy
      signal purge), blocks automatic entries when the persisted daily-PnL
      stop is reached, and lets manual/force-exit decisions bypass
      `runnerEnabled`. `entry-diagnostics` surfaces both blocks via the
      `DAILY_PNL_LIMIT`/`BLACK_SWAN_PROTECTION` codes and a shared
      `DAILY_PNL_LIMIT` guard row. Feature ports landed:
      `run`/`entry`/`exit` routes drive the shared `RuntimeEngine` through
      `production.runtime.runManual` (serialized against the live loop,
      runner-gate bypass, forced entry/exit semantics, read-only
      `overrideRunnerGate` for diagnostics); `entry-diagnostics` evaluates
      the new pipeline read-only via `system/trading/entry-diagnostics`
      and `EntryBlockers` consumes `RuntimeEntryDiagnosticsSnapshot`;
      `quick-backtest` is engine-driven via `dev/quick-backtest`
      (per-account `RuntimeEngine` run, stored vPoints before `startTime`
      seed detection, equity snapshots feed metrics/trade history/growth
      + simulation series) with `dev/klines` shared dataset utils and
      `RuntimeEngineState.volume24hMap` for the entry volume cap;
      `debug/*` storage sync routes use `dev/storage-sync` (the two
      coin-metadata debug routes keep only their `devBacktest/coins`
      imports). Zero `@/lib/slowTrading` importers remain in
      pages/components/app. Live-surface leftovers cleared: the dashboard
      `volatility`/`initialize`/`klines` routes now run the canonical
      detector (`system/utils/vpoints.detectVPoints`) over
      `system/utils/klines.downloadRange` (batched exchange paging moved
      out of `dev/klines`, with a `closedOnly` flag for chart tails) and
      persist through `runtimeStorage.vpoints`; `converter.ts` consumes
      system `Position`/`VolatilityPoint` and owns `MultiLinePair`;
      `trading-live-preview`/`entry-sequence-candidates` use system
      `EntryRecommendation` + `entry.threshold.resolve`; `formatDuration`/
      `timeMsToReadable`/`vpoint-pct-distribution` ported to
      `system/utils`; `windowsMs`, `DECISION_MODELS`, and
      `VOLATILITY_THRESHOLD` live in `system/constants`; dashboard/config
      defaults come from `runtimeDefaults`. `devBacktest/` callers split into two groups.
      **Rejected surfaces** — deleted in Phase 7: `/dev/backtest-vrails`,
      `pages/api/dev/dynamic-trade/*`, `/dev/coins` + `/dev/black-swan`
      pages and their routes (`api/dev/coins`, `api/dev/black-swan`),
      `devBacktest/api/{coinFinder,dynamicTradeBacktest,leaderboards}`,
      `devBacktest/volatility-dataset`, the coin-analysis modules
      `devBacktest/coins/{capital-efficiency,correlation,health,result}`,
      `components/api/dynamic/*`, `components/api/utils.tsx`, and
      `components/api/production/utils.ts`.
      **Live features pending relocation** — used by the approved pages
      (`/`, `/dev/precision-checker`, `/dev/backtest-precision`), so the
      rule is *move, don't delete*: coin metadata (dashboard tag UI,
      `CoinTagManagerDialog`, `/api/slow-trading/coin-metadata`,
      `debug/*coin-metadata*` routes, `api/mcp.ts` tag handlers) is
      backed by `devBacktest/coins/{tags,tag-sync,tag-types,
      filter-config}` + `devBacktest/api/coinTags` → relocate to
      `lib/dev/coins` (only legacy dep: `tag-sync` uses `tradeLog` →
      swap to `systemLog`); the Black Swan savings preview
      (`BlackSwanSavingsPreview` in the settings dialog →
      `/api/slow-trading/black-swan-preview`) is backed by
      `devBacktest/black-swan` + `devBacktest/api/blackSwanBacktest`,
      which internally pull `slowTrading/{quick-backtest,stages,
      watch-reserve}`, `trading/*`, `dynamic`, `datasets` — relocating
      means porting the preview onto the Precision engine;
      `env/devBacktest.isDevBacktestEnabled` → `lib/dev` (consumed by
      the four approved dev surfaces).
- [ ] Verify no code outside the legacy quarry imports legacy folders.
      Pending: the live-feature relocations listed above
      (`devBacktest/coins` tag store, `devBacktest/black-swan` preview,
      `env/devBacktest` flag). Verified so far: no live surface
      references `slowTrading`, `dynamic`, `brain`, `evaluate`,
      `datasets`, or the old `trading/*` internals — only the listed
      `devBacktest`/`env` edges remain.

### Phase 7 — deletion (separate approval required)

Nothing is deleted automatically after migration. First produce an inventory
showing:

- Zero runtime importers.
- Zero API/page/component importers.
- Which tests still import each legacy folder.
- Which files are wholly unreachable.
- Precision comparison results for recorded cases.

Deletion removes folders and rejected surfaces, not live features: any
code inside the roots below that is still used by `/`,
`/dev/precision-checker`, or `/dev/backtest-precision` relocates to an
authoritative root under Phase 6 before its folder can be deleted.

Only then ask for explicit deletion approval for:

- `slowTrading/`.
- `dynamic/`.
- `brain/`.
- Old `trading/`.
- `devBacktest/`.
- `evaluate/`.
- Old `datasets/`, `notification/`, `runtime/`, and `env/`.
- `/dev/coins` and `/dev/black-swan` pages.

## Verification gates

Each migration slice must pass before another boundary is changed:

```bash
npm run type
npm run quality
```

For behavior-sensitive extraction (vPoints, decisions, entry, averaging, exit,
execution accounting), also compare the old and new implementation over the
same captured inputs until the new path becomes authoritative.

Completion means more than passing TypeScript: production, sandbox, and
backtest must use the same Precision runtime and Multi strategy path, with only
their adapters differing.

## Documentation authority

Use documentation in this order:

1. Current human instructions.
2. `docs/PRECISION/_PRECISION.md` as the architectural backbone.
3. Precision documents explicitly reviewed and approved by the human.
4. `docs/SPECS/` only as a **legacy behavioral reference**.

`docs/SPECS/` may be used to identify existing Multi calculations, cycle
behavior, decision rules, edge cases, and requirements that still need to be
preserved. It is not design authority for the new system.

Do not inherit the following from legacy specs unless the human explicitly
approves it:

- Folder structure.
- Runtime architecture.
- Type design.
- Legacy module boundaries.
- Versioned decision-engine structure.
- Dynamic or NN abstractions.
- Any assumption that conflicts with `docs/PRECISION/_PRECISION.md`.

When legacy specs and Precision direction conflict, stop and resolve the
behavioral requirement separately from the legacy implementation. Preserve a
required outcome without carrying its old architecture into the clean core.

## Human constraints (authoritative)

- This repository, not the old Multi instance, is the behavioral source.
- Do not move or delete legacy code during the clean-core build.
- Create straightforward new APIs aligned with Precision.
- The important roots and code outside `lib` must become unattached from legacy
  dependencies.
- Anything related to dev pages belongs under `lib/dev`.
- Shared utilities and types belong under `lib/system`.
- Multi is the default strategy of the precision system, dissolved into
  `lib/system/trading`, `lib/system/utils`, and `lib/precision/utils`;
  `RuntimeEngine` calls those functions directly and `adapter.onStrategy` is
  the arrangement/veto gate.
- Legacy NN, dynamic types, price norm, and decision versions are not part of
  the new foundation.
