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

These new folders also become ground truth:

```text
src/lib/system
src/lib/strategy/multi
```

Final authoritative roots:

```text
src/lib/
  exchange/
  precision/
  production/
  dev/
  strategy/
    multi/
  system/
```

Everything else under `src/lib` is a **legacy quarry**. It may be inspected to
preserve required behavior, but new ground-truth code must not depend on it.

## Current inventory

| Folder | Role today | Decision |
|---|---|---|
| `exchange/` | Exchange contracts, adapters, and platform clients | Keep; detach from legacy logging/trading types |
| `precision/` | New shared `RuntimeEngine`, monitoring, actions, helpers | Keep; detach from `brain`, `dynamic`, `slowTrading`, and old `trading` |
| `production/` | Production clock, state, factory, adapter, recorder | Keep; rebuild dependencies through clean ports |
| `dev/` | Precision backtest and Precision Checker | Keep; all dev-page libraries belong here |
| `strategy/` | Empty placeholder | Build `strategy/multi` as the Multi implementation of the Precision strategy contract |
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

  strategy/
    multi/                        # Multi implementation of Precision strategy
      decision/
      vpoints/
      entry/
      averaging/
      exit/
      types.ts
      index.ts

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
system      -> no dependency on precision, strategy, production, dev, or legacy
exchange    -> system only
precision   -> system + its own abstract ports/contracts
strategy    -> system + precision strategy contracts
production  -> system + exchange + precision + strategy
 dev         -> system + exchange + precision + strategy
```

Forbidden in all new ground-truth code:

```text
precision   -> slowTrading | dynamic | brain | old trading
strategy    -> slowTrading | dynamic | brain | old trading
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

Contains only small reusable foundations. It must not know about Multi,
production, sandbox, backtest, dashboard pages, or SLOW runtime orchestration.

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
- Strategy.

It must not load files, instantiate exchanges, send notifications, or import
Multi-specific decision code directly.

### `strategy/multi`

Implements the strategy callback used by `RuntimeEngine` (`onStrategy` or its
final equivalent). It owns Multi-specific decision behavior, entry, averaging,
exit, and strategy-specific state.

Reinvent the **API and structure**, not verified behavior. Required vPoint and
Multi calculations should be transferred from this repository and protected by
characterization tests. Do not import the legacy implementation from the new
strategy; otherwise legacy remains part of the runtime.

The existing vPoint algorithm is behavioral source material, but batch and
incremental processing should share one canonical clean processor so backtest,
sandbox, and live cannot diverge.

### `production`

Implements Precision ports for live and sandbox:

- Real clock and scheduling.
- Exchange-backed market data.
- Exchange-backed execution.
- Persistent storage.
- Notification delivery.
- Runtime monitoring and production test-case recording.

It composes `RuntimeEngine` with `strategy/multi`; it does not contain strategy
rules.

### `dev`

Contains everything used by dev pages, including Precision backtest and
Precision Checker. Backtest must compose the same `RuntimeEngine` and
`strategy/multi`, replacing only environment adapters.

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

- [ ] Audit the exact state and adapter data required by `RuntimeEngine`.
- [ ] Create minimal `system/types` and `system/trading` contracts.
- [ ] Define Precision ports for clock, market, execution, storage,
      notification, monitoring, and strategy.
- [ ] Keep types environment-neutral and strategy-neutral.
- [ ] Add dependency-boundary enforcement so authoritative roots cannot import
      legacy paths.

### Phase 2 — detach `precision`

- [ ] Replace `dynamic` market/vPoint types with clean types.
- [ ] Replace `slowTrading` symbol, schedule, reserve, monitoring, and position
      dependencies with Precision-owned behavior or ports.
- [ ] Replace `brain` default decisions with the strategy port.
- [ ] Replace old `trading` models/actions with `system/trading` contracts.
- [ ] Finish with zero legacy imports in `src/lib/precision`.

### Phase 3 — implement `strategy/multi`

- [ ] Define the exact strategy interface consumed by `RuntimeEngine`.
- [ ] Add characterization tests for required Multi behavior before transfer.
- [ ] Implement one canonical vPoint stream processor shared by batch and
      incremental operation.
- [ ] Transfer current Multi entry, averaging, exit, and decision behavior into
      the new strategy structure.
- [ ] Do not transfer NN, price norm, dynamic legacy types, or old decision
      versions.
- [ ] Finish with zero legacy imports in `src/lib/strategy/multi`.

### Phase 4 — detach `production`

- [ ] Build clean production implementations of every Precision port.
- [ ] Recreate only required persistence APIs under `system/storage` and the
      production storage adapter.
- [ ] Preserve the approved `prod/` and `dev/` persistent-storage layout.
- [ ] Wire live and sandbox through the same RuntimeEngine + Multi strategy path.
- [ ] Finish with zero legacy imports in `src/lib/production`.

### Phase 5 — detach `dev`

- [ ] Wire Precision backtest to the same RuntimeEngine + Multi strategy path.
- [ ] Wire Precision Checker and production test-case replay to clean contracts.
- [ ] Rebuild only dev capabilities still present in approved pages.
- [ ] Finish with zero legacy imports in `src/lib/dev`.

### Phase 6 — detach `exchange` and application callers

- [ ] Replace exchange imports of the old trading logger, notification helper,
      and balance types with `system` APIs.
- [ ] Rewire pages, API routes, components, and workers to authoritative roots.
- [ ] Verify no code outside the legacy quarry imports legacy folders.

### Phase 7 — deletion (separate approval required)

Nothing is deleted automatically after migration. First produce an inventory
showing:

- Zero runtime importers.
- Zero API/page/component importers.
- Which tests still import each legacy folder.
- Which files are wholly unreachable.
- Precision comparison results for recorded cases.

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

## Human constraints (authoritative)

- This repository, not the old Multi instance, is the behavioral source.
- Do not move or delete legacy code during the clean-core build.
- Create straightforward new APIs aligned with Precision.
- The important roots and code outside `lib` must become unattached from legacy
  dependencies.
- Anything related to dev pages belongs under `lib/dev`.
- Shared utilities and types belong under `lib/system`.
- Multi strategy behavior belongs under `lib/strategy/multi` and connects to
  `RuntimeEngine` through the strategy adapter.
- Legacy NN, dynamic types, price norm, and decision versions are not part of
  the new foundation.
