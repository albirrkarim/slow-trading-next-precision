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

- **Cheapest immediate wins:**
  - [ ] delete `src/lib/strategy/` (empty placeholder — real one comes as
        `strategy/multi`)
  - [ ] consolidate dev homes: `devBacktest/` → `dev/backtest/`,
        `evaluate/` → `dev/evaluate/` (or delete)
- **Foundation moves (before strategy work):**
  - [ ] `trading/` → `system/trading/` (execution + models)
  - [ ] `notification/` → `system/notification/`
  - [ ] `datasets/`, `runtime/`, `env/` → `system/`
  - [ ] `components/storage.ts` + `persistent-storage-root.ts` +
        `slowTrading/storage/{json-file,mode-files,history-files}.ts` →
        `system/storage/`
- **The main migration:** `slowTrading` runtime behavior → `precision/`
  engine + `strategy/multi`; move current vPoint/decision logic from
  `brain/algorithms/v4/decisions/v20` into `strategy/multi`.
- **Delete last:** `dynamic/`, `brain/`, `slowTrading/` — once nothing
  imports them.


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
