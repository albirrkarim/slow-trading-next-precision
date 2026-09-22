# Storage Redesign

Implemented layout for `storage/persistent/instances/<port>/`. Goal: one file =
one concern, one writer. The `memory.json` monolith is gone, and production
truth, rebuildable caches, and dev artifacts no longer share a directory.

This is the only layout — the instance ships fresh with no compatibility or
migration machinery. `components/storage.ts` creates the directory tree
synchronously at module load and exports `FILES` path constants; every
reader/writer addresses `FILES.prod`/`FILES.dev` paths directly.

## Problems with the old layout

- **`memory.json` is five files in one.** Positions + balances churn every
  action, `stageRuns`/`lastRun*` are dashboard diagnostics, notification and
  blackSwan state change rarely — all forced into a single atomic write. Every
  write rewrites ~16KB of unrelated state.
- **Cross-account write hazard.** `saveSlowTradingModeState` must re-load the
  file before writing just to not clobber the *other* account — the layout is
  the bug.
- **Positions do a flatten/un-flatten dance.** In memory they live as
  `tradeSettings[].model_memory.positions`; on disk they're
  `accounts.<slug>.<mode>.positions`. `toPersistedModeState` /
  `fromPersistedModeState` exist only to translate that shape — and the
  precision runtime already wants a flat `Position[]`.
- **`pnl.history` is unbounded inside every position.** A `{t, pct}` entry
  every 5 min per position — this alone will dominate the file over time.
- **Dev artifacts sit in production storage.** `leaderboards.json` and the
  precision-test-case recorder pointer are dev tooling; `dev/` already exists.
- **Caches look like truth.** `marketcap_cache.json`, `ip.json`,
  `notification-dedupe.json` are rebuildable/expire-able but sit next to
  `accounts.json` as if they mattered.
- **Account data is scattered.** Positions/balances nest inside `memory.json`
  by account+mode, balance snapshots are `<mode>/balance_snapshots/<slug>.json`,
  history is `<mode>/history/<SYMBOL>.json` — three different groupings for the
  same account's data.
- **`slow/` names the strategy, not the scope.** The sibling dir is `dev/`;
  the production side should be `prod/` — environment-scoped, strategy-neutral.

## Target layout

```text
instances/<port>/
  prod/                                   ← production runtime truth only
    config.json                           ← exchangeType, tradingMode, symbols, thresholds
    accounts.json                         ← credentials/secrets
    queue.json                            ← pending safeHaven/withdrawal ops

    status.json                           ← {mode: {stageRuns, lastRun*, blackSwan, dailyPnlLimitState}}
                                            ←   global system status — dailyPnlLimitState sums ALL
                                            ←   accounts' shared history, blackSwan uses global
                                            ←   config + market evidence, lastRun* describes the
                                            ←   system cycle
    notifications.json                    ← {mode: {highVolatility, dailyPerformance,
                                            ←   dailyPnlLimit*NotificationState}} — global send
                                            ←   dedupe; authoritative dedupe also lives in
                                            ←   cache/notification-dedupe.json by dedupeKey

    accounts/<slug>/<mode>/               ← everything this account+mode owns
      positions.json                      ← Position[] flat — exactly what state.openPositions is
      balance.json                        ← dynamicTradeMemory: startingBalance, quoteAsset, reserved, safeHaven*
      balance_snapshots.json              ← equity curve

    history/<mode>/<SYMBOL>.json          ← closed positions, shared across accounts —
                                          ←   each row carries `account` — the file is shared,
                                          ←   ownership stays on the row

    volatility/<exchange>/<SYMBOL>.json   ← vPoint store, shared market data

    cache/                                ← safe to delete entirely
      marketcap.json
      ip.json
      notification-dedupe.json
      ticker-24h-<exchange>-<market>.json ← 24h ticker snapshot

    logs/                                 ← unchanged append-only ops logs
      binance_cooldowns.json
      errors.json
      management.json
      safe_haven.json
      withdrawals.json

  dev/                                    ← dev tooling artifacts only
    leaderboards.json
    precision-test-case.json              ← recorder pointer
    precision-test-case/
      <capture>.json                      ← completed + in-progress captures; pointer stays
                                          ←   outside so listings see captures only
    coin-tags.sqlite                      ← unchanged
```

One rule: **account-owned runtime state lives under `accounts/<slug>/<mode>/`,
shared/global data is grouped by kind at the top level** (`history/<mode>/`,
`volatility/<exchange>/`, `status.json`, `notifications.json`). Positions,
balance, and snapshots belong to an account+mode — one directory each, single
writer. Status and notification state are global system state keyed by mode:
the daily-PnL stop is computed across every account's shared history
(`PROD:MULTI_ACCOUNT_COMBINED_DAILY_PNL`), black-swan evidence/config is
global, and notification dedupe keys carry no account component. History is
shared because each row already carries its `account` field: one file per
mode+symbol, filtered on read, atomically merged on write.

`prod/` vs `dev/` is the environment boundary — both live and sandbox modes
write under `prod/accounts/<slug>/<mode>/`. (`prod` was previously a stale
alias for the live *mode* in balance snapshots and was removed for that; here
it means the production *environment*, a different thing.)

## What leaves `memory.json`

| Current location | Target | Churn |
|---|---|---|
| `accounts.<slug>.<mode>.positions` | `accounts/<slug>/<mode>/positions.json` | every action |
| `dynamicTradeMemory` (balance fields) | `accounts/<slug>/<mode>/balance.json` | every action |
| `highVolatilityNotificationState`, `dailyPerformance*`, `dailyPnlLimit*NotificationState` | `notifications.json[mode]` | rare |
| `blackSwan`, `dailyPnlLimitState` | `status.json[mode]` | rare |
| `stageRuns`, `lastRunAt/Duration/Summary/Performance` | `status.json[mode]` | every stage run |

`positions.json` shape = flat `Position[]`, no `model_memory` embedding —
the precision runtime's `state.openPositions` serializes directly.

`pnl.history`: bound it (e.g. keep last N samples) or move it to the closed
`history/` file at exit. It must not grow unbounded inside `positions.json`.

## Write-boundary map

| File | Writer | When |
|---|---|---|
| `accounts/<slug>/<mode>/positions.json` | `saveSlowTradingModeState` via `mode-files.ts` | after entry/averaging/exit |
| `accounts/<slug>/<mode>/balance.json` | same boundary | same |
| `status.json` / `notifications.json` | same boundary — mode slice replaced wholesale | every save |
| `history/<mode>/<SYMBOL>.json` | `persistClosedPositionsToHistoryFiles` (`update.atomic` merge) | on position close |
| `accounts/<slug>/<mode>/balance_snapshots.json` | snapshot writer | daily |
| `volatility/<exchange>/<SYMBOL>.json` | `onNewVPoint` + `onStateChange` flush | new point / marker set |
| `queue.json` | queue persistence | on enqueue/dequeue |
| `cache/*` | cache writers | on refresh/expiry |

Per-account files mean account 1's write can never clobber account 2 —
the load-modify-write dance in `saveSlowTradingModeState` disappears.

## Implementation notes

- **Split `memory.json`** — `mode-files.ts` reads/writes the
  per-account-mode files plus the two global mode-keyed files;
  `persistence.ts` maps them onto the runtime `modeState` shape.
  `toPersistedModeState`/`fromPersistedModeState` still flatten/scatter
  `tradeSettings[].model_memory.positions` at the file boundary because the
  legacy runtime keeps that shape in memory — they can go when
  `precision/features` owns the model.

`status.json` and `notifications.json` are global files keyed by mode —
`{live: {...}, sandbox: {...}}`. The mode slice is replaced wholesale on save;
this is safe because accounts execute sequentially and the fields are computed
from global inputs, so every account derives identical values (the last
writer's `stageRuns`/`lastRun*` also carry the cycle's fullest cumulative
performance). Account deletion leaves these files untouched — they describe
the system, not the account.

## Remaining notes

- `accounts.json` (credentials) vs `accounts/<slug>/` (runtime) sharing the
  name — kept as-is; credentials rarely change and atomic multi-account write
  is fine.
- `pnl.history` is still unbounded inside each position — bound it or move it
  to the closed `history/` file at exit in a follow-up.
- `status.json` diagnostics (`stageRuns`, `lastRun*`) are dashboard-facing —
  if they prove lose-able they can move to `cache/` later.
