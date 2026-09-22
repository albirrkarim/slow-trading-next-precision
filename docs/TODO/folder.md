# src/lib Folder Assessment

The `src/lib` tree is messy with legacy code — three generations of
architecture coexist. Below is the content of each folder and an assessment.

## Folder inventory

| Folder | Files | What it is | Target |
|---|---|---|---|
| `exchange/` | 92 | Exchange abstraction + adapters (`binance`, `okx`, `tokocrypto`) | `lib/exchange` — keep |
| `precision/` | 20 | **New** runtime: `RuntimeEngine`, `monitoring/`, `defaultDecision/`, `action/` | `lib/precision` — keep |
| `production/` | 12 | Production adapter for the precision engine (`adapter`, `clock`, `factory`, `recorder`) | `lib/production` — keep |
| `slowTrading/` | 81 | Legacy SLOW runtime: `cycle/` stages, `storage/`, `queue/`, signals, mcp, ~30 flat files | **Remove** — replaced by precision engine + `production/` + `strategy/multi` |
| `dynamic/` | 38 | Legacy backtest engine + `.d.ts` types + `priceNorm` + `utils/nn/` | **Remove** — legacy per `_PRECISION.md` F.1 |
| `trading/` | 32 | Execution accounting + `models/` with shared `Position`/`TradeSettings` | `lib/system/trading` |
| `devBacktest/` | 20 | Dev tooling: coin finder/tags, black-swan backtest, volatility dataset | `lib/dev/` — minus non-goal pages |
| `brain/` | 18 | Prediction algorithms — nested `algorithms/v4/decisions/v20/` | **Remove** — current vPoint/decision logic moves into `strategy/multi`; version nesting dies |
| `evaluate/` | 13 | Leaderboard/performance/stability analysis | `lib/dev/` if still needed |
| `dev/` | 9 | `backtestPrecision` + `precisionChecker` | `lib/dev/` — keep, becomes the one dev home |
| `datasets/` | 4 | Klines fetching | `lib/system/` |
| `notification/` | 3 | Channels + global dedupe | `lib/system/notification` |
| `runtime/` | 2 | `instance-ip`, `resource-monitor` | `lib/system/` |
| `env/` | 1 | `devBacktest.ts` flag | `lib/system/` |
| `strategy/` | 0 | Empty directory | `lib/strategy/multi` — gets the strategy impl |

Related moves outside `lib/`: `src/components/storage.ts` (`FILES`
registry) and `src/lib/persistent-storage-root.ts` land under
`lib/system/storage` alongside `json-file`/`mode-files`/`history-files`.

## Target shape

```text
lib/
  exchange/           ← keep — exchange abstraction + adapters
  precision/          ← keep — RuntimeEngine + monitoring + action
  production/         ← keep — production adapter for RuntimeEngine

  dev/                ← anything related to dev pages goes here
    precision-checker/
    backtest-precision/
    backtest/         ← from devBacktest/ (minus /dev/coins + /dev/black-swan,
                        per _PRECISION.md F.1)
    evaluate/         ← leaderboard analysis, if it survives

  system/             ← utils, types, shared infra
    trading/          ← execution accounting + Position/TradeSettings models
    notification/     ← channels + dedupe
    storage/          ← FILES registry, persistent-storage-root, json-file,
                        mode-files, history-files
    datasets/         ← klines fetching
    runtime/          ← instance-ip, resource-monitor
    env/              ← env flags

  strategy/
    multi/            ← Multi strategy impl — plugs into RuntimeEngine
                        onStrategy adapter (later: streak, hedge per V2)
```

## Removed entirely (legacy)

- `lib/slowTrading/` — the legacy runtime. The storage layout it owns is
  already the new layout (`prod/`, `dev/`); the runtime itself is replaced
  by the precision engine + production adapter + strategy/multi.
- `lib/dynamic/` — legacy backtest/dynamic sim, `nn` features, `priceNorm`,
  `type-dynamic.d.ts`/`type-backtest.d.ts` — all legacy types.
- `lib/brain/` — prediction engine with versioned decisions. Only the
  current vPoint formation + decision logic moves into `strategy/multi`
  (per `_PRECISION.md` H: don't reinvent it). Older decision versions
  (v12–v19) and the `v4/decisions/v20` nesting do not migrate.
- `devBacktest/` `/dev/coins` + `/dev/black-swan` pages — non-goals per
  `_PRECISION.md` F.1.
- `evaluate/` — only lives if dev leaderboards still need it.

## Order of attack

**Phase 1 — moves + import-path updates only. No deletions.** Every move is
mechanical: relocate files, update `@/lib/...` imports, keep everything
working. Old folders stay until explicitly deleted later.

### Phase 1 move map

| From | To | Notes |
|---|---|---|
| `trading/` | `system/trading/` | Execution accounting + `models/` (shared `Position`, `TradeSettings`) |
| `notification/` | `system/notification/` | Channels + dedupe store |
| `datasets/` | `system/datasets/` | Klines fetching |
| `runtime/` | `system/runtime/` | `instance-ip`, `resource-monitor` |
| `env/` | `system/env/` | dev flag |
| `components/storage.ts` | `system/storage/files.ts` | `FILES`/`CACHE_DIR`/`FOLDER` registry + bootstrap |
| `persistent-storage-root.ts` | `system/storage/root.ts` | Instance root resolution |
| `slowTrading/storage/json-file.ts` | `system/storage/json-file.ts` | Atomic write/update — generic primitive |
| `slowTrading/debug-sync.ts` | `system/storage/debug-sync.ts` | Bundle export/import — storage-generic |
| `devBacktest/` | `dev/backtest/` | Dev consolidation; non-goal pages still work, just moved |
| `evaluate/` | `dev/evaluate/` | Only used by devBacktest + tests |
| `dev/backtestPrecision/` | `dev/backtest-precision/` | Naming consistency (optional) |

### `slowTrading/` arrangement (Phase 1)

The folder is the legacy runtime — most of it eventually gets **replaced**
by `precision/` + `strategy/multi`, not moved. Phase 1 carves out only the
generic pieces; the domain files stay with the runtime until the migration
decides their home.

**Moves out (generic, no slowTrading-type coupling):**

| From | To |
|---|---|
| `slowTrading/storage/json-file.ts` | `system/storage/json-file.ts` |
| `slowTrading/debug-sync.ts` | `system/storage/debug-sync.ts` |
| `slowTrading/public-market-cache.ts` | `system/` (single-flight cache helper — confirm exact home during move) |
| `slowTrading/binance-health.ts` | `system/` or `exchange/` — binance cooldown persistence; borderline |
| `slowTrading/market-volume.ts` | `system/` or `exchange/` — 24h ticker snapshot cache; borderline |

**Stays in `slowTrading/` (domain storage — typed to `SlowTradingMode` /
`SlowTradingStorageData`, moving it means dragging the domain types):**

`storage/{persistence,mode-files,mode,account,history,history-files,logs,
dashboard,balance-snapshots,internal-types,common,constants,
safe-haven-config,withdrawal-config,mcp-config,index}.ts`

> Alternative: move the whole `storage/` subtree to `system/storage/slow/`
> and keep it importing `SlowTradingMode` (just `"live" | "sandbox"`) —
> rejected for Phase 1 because `SlowTradingStorageData` coupling makes the
> backward imports ugly; revisit when `precision` owns the model.

**Stays in `slowTrading/` (legacy runtime — replaced by precision +
strategy/multi later, not moved):**

`cycle/*`, `signals.ts`, `runner.ts`, `stages.ts`, `stage-run.ts`,
`singleton.ts`, `shared.ts`, `types.ts`, `client.ts`, `index.ts`,
`positions.ts`, `management.ts`, `entry-sequences.ts`, `watch-reserve.ts`,
`exit-sideways/*`, `black-swan.ts`, `daily-pnl-limit.ts`,
`auto-remove-symbols.ts`, `exchange-sync.ts`, `balance*.ts`,
`withdrawal*.ts`, `safe-haven-schedule.ts`, `queue/*`, `mutation-queue.ts`,
`notifications.ts`, `daily-performance.ts`, `pnl-history.ts`,
`reporting.ts`, `finance-summary.ts`, `balance-summary.ts`,
`performance.ts`, `market.ts`, `worker-capacity.ts`, `account-config.ts`,
`quick-backtest.ts`, `mcp*` — each gets ported into `precision/` features
or `strategy/multi/` during the real migration, then the folder dies.

### `strategy/multi` move plan (Phase 1, confirmed)

Multi strategy = the current decision + vPoint code. Moves:

| From | To | Notes |
|---|---|---|
| `brain/algorithms/v4/decisions/v20/*` | `strategy/multi/decisions/` | Current decision impl |
| `brain/algorithms/v4/decisions/helper/*` | `strategy/multi/decisions/helper/` | Imported by v20 |
| `brain/algorithms/v4/decisions/utils.ts`, `index.ts` | `strategy/multi/decisions/` | Decision glue |
| `brain/algorithms/v4/execute/*` | `strategy/multi/execute/` | Trade execution glue |
| `brain/algorithms/type-execute.d.ts` | `strategy/multi/` | Ambient type decl — verify it still resolves after move |
| `dynamic/utils/volatility/*` | `strategy/multi/vpoints/` | **vPoint formation engine — preserve verbatim** (`_PRECISION.md` H) |

Import peel: moved files import `@/lib/dynamic` (types + utils) and
`@/lib/trading/*`. Trading imports retarget to `system/trading`. Dynamic
imports get peeled to only what's used (`VolatilityPoint`,
`PredictionEngineMemory`, `TradeSettings`-adjacent types) — those land in
`system/trading/models` or `strategy/multi/types`; `nn`, `priceNorm`,
`type-*.d.ts` stay behind in `dynamic/` and die with it.

Left in `brain/` after the move: `index.ts`, `constants.ts`,
`algorithms/index.ts`, `v4/index.ts` — barrel/glue only, dies in Phase 2.

### Phase 1 execution order

1. `system/` foundation: `trading`, `notification`, `datasets`, `runtime`,
   `env`, storage primitives (`files`, `root`, `json-file`, `debug-sync`)
2. `dev/` consolidation: `devBacktest` → `dev/backtest`, `evaluate` →
   `dev/evaluate`
3. `strategy/multi` surgery: brain v20 + vPoint engine move
4. Verify: `npm run type` + `npm run quality` after each step

**Phase 2 — deletions (later, on request).** `dynamic/`, `brain/`,
`slowTrading/`, `dev/coins` + `dev/black-swan` pages — deleted only after
nothing imports them and the user confirms.


## NOTES FROM HUMAN

- This codebase is already copied from the Multi instance — **do not look
  back at `slow-trading-next-multi`** (it's dirty). This repo is the source
  of truth for the Multi strategy code.

Target scope (authoritative):

- `lib/exchange`, `lib/precision`, `lib/production` — keep
- `lib/dev/*` — anything related to dev pages goes here
- `lib/system` — utils, types (`system/trading`, `system/notification`,
  `system/storage`, `system/*`)
- `lib/strategy/multi` — the strategy impl for `onStrategy` on the
  RuntimeEngine adapter
- Everything else is nonsense: `nn`, dynamic types, decision versions —
  legacy (see `docs/PRECISION/_PRECISION.md` F.1)
