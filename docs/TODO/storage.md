# Storage Redesign

Target layout for `storage/persistent/instances/<port>/`. Goal: one file =
one concern, one writer. Kill the `memory.json` monolith and stop mixing
production truth, rebuildable caches, and dev artifacts in the same directory.

## Problems with the current layout

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
  prod/                                   ← production runtime truth only (was: slow/)
    config.json                           ← unchanged: exchangeType, tradingMode, symbols, thresholds
    accounts.json                         ← unchanged: credentials/secrets
    queue.json                            ← unchanged: pending safeHaven/withdrawal ops
    status.json                           ← stageRuns, lastRun*, blackSwan, dailyPnlLimit
                                          ←   dashboard diagnostics; rewritten as a unit
    notifications.json                    ← per-account-mode notification state
                                          ←   (highVolatility, dailyPerformance, dailyPnlLimit)

    accounts/<slug>/<mode>/               ← everything this account+mode owns
      positions.json                      ← Position[] flat — exactly what state.openPositions is
      balance.json                        ← startingBalance, quoteAsset, reserved, safeHaven*
      balance_snapshots.json              ← equity curve (was: <mode>/balance_snapshots/<slug>.json)
      history/<SYMBOL>.json               ← closed positions (was: <mode>/history/<SYMBOL>.json)

    volatility/<exchange>/<SYMBOL>.json   ← vPoint store, shared market data
                                          ←   (was: <exchange>/volatility/<SYMBOL>.json)

    cache/                                ← safe to delete entirely
      marketcap.json
      ip.json
      notification-dedupe.json

    logs/                                 ← unchanged append-only ops logs
      binance_cooldowns.json
      errors.json
      management.json
      safe_haven.json
      withdrawals.json

  dev/                                    ← dev tooling artifacts only
    leaderboards.json                     ← moved from slow/
    precision-test-case/
      <capture>.json                      ← unchanged
      active.json                         ← recorder pointer (was: slow/precision-test-case.json)
    coin-tags.sqlite                      ← unchanged
```

One rule: **account data lives under `accounts/<slug>/<mode>/`, shared market
data under `volatility/<exchange>/`**. Positions, balance, snapshots, and
history all belong to an account+mode — putting them in one directory removes
the three-way grouping inconsistency entirely.

`prod/` vs `dev/` is the environment boundary — both live and sandbox modes
write under `prod/accounts/<slug>/<mode>/`. (`prod` was previously a stale
alias for the live *mode* in balance snapshots and was removed for that; here
it means the production *environment*, a different thing.)

## What leaves `memory.json`

| Current location | Target | Churn |
|---|---|---|
| `accounts.<slug>.<mode>.positions` | `accounts/<slug>/<mode>/positions.json` | every action |
| `dynamicTradeMemory` (balance fields) | `accounts/<slug>/<mode>/balance.json` | every action |
| `highVolatilityNotificationState`, `dailyPerformance*`, `dailyPnlLimit*NotificationState` | `notifications.json` | rare |
| `blackSwan`, `dailyPnlLimitState` | `status.json` | rare |
| `stageRuns`, `lastRunAt/Duration/Summary/Performance` | `status.json` | every stage run |

`positions.json` shape = flat `Position[]`, no `model_memory` embedding —
the precision runtime's `state.openPositions` serializes directly.

`pnl.history`: bound it (e.g. keep last N samples) or move it to the closed
`history/` file at exit. It must not grow unbounded inside `positions.json`.

## Write-boundary map

| File | Writer | When |
|---|---|---|
| `accounts/<slug>/<mode>/positions.json` | production adapter `onStateChange`/`onExit` | after entry/averaging/exit |
| `accounts/<slug>/<mode>/balance.json` | same boundary | same |
| `accounts/<slug>/<mode>/history/<SYMBOL>.json` | persistence layer | on position close |
| `accounts/<slug>/<mode>/balance_snapshots.json` | snapshot writer | daily |
| `volatility/<exchange>/<SYMBOL>.json` | `onNewVPoint` + `onStateChange` flush | new point / marker set |
| `status.json` | stage/cycle runner | end of each stage run |
| `notifications.json` | notification senders | on send |
| `queue.json` | queue persistence | on enqueue/dequeue |
| `cache/*` | cache writers | on refresh/expiry |

Per-account files mean account 1's write can never clobber account 2 —
the load-modify-write dance in `saveSlowTradingModeState` disappears.

## Migration order

1. **Rename the root** — `slow/` → `prod/` (`SLOW_TRADING_DIR` /
   `FILES.slow` become `FILES.prod`). One-time directory move; every path
   below flows from it.
2. **Move dev files out** — `leaderboards.json` → `dev/`, recorder pointer →
   `dev/precision-test-case/active.json`. Zero risk, no runtime coupling.
3. **Move caches under `cache/`** — repoint `FILES` keys, move files.
4. **Split `memory.json`** — land positions/balance writes behind the same
   `saveState` boundary, then delete the flat↔nested translators in
   `storage/mode.ts` (`toPersistedModeState`/`fromPersistedModeState` collapse
   into plain JSON read/write).
5. **Rehome account history + snapshots** — `<mode>/history/<SYMBOL>.json` →
   `accounts/<slug>/<mode>/history/<SYMBOL>.json` (history entries already
   carry `account`; split files by it), `<mode>/balance_snapshots/<slug>.json`
   → `accounts/<slug>/<mode>/balance_snapshots.json`.
6. **Flip volatility to kind-first** — `<exchange>/volatility/<SYMBOL>.json` →
   `volatility/<exchange>/<SYMBOL>.json`. Move files, update `FILES` +
   the `volatility(exchange)` helper.
7. **Delete `memory.json`** once nothing reads it.

Steps 1–3 are pure path changes. Steps 4–5 are the real work — do them
alongside the `precision/features` migration since both change the same
persistence seam. Step 5 changes per-symbol history files from mode-scoped to
account-scoped: on migrate, read each `<mode>/history/<SYMBOL>.json`, group
entries by `account` field, write per-account files.

## Open questions

- `accounts.json` (credentials) vs `accounts/<slug>/` (runtime) sharing the
  name — keep credentials in one file (rarely changes, atomic multi-account
  write is fine) or split per slug too? Leaning keep-as-is; renaming
  credentials to `credentials.json` would make the `accounts/` dir
  unambiguous.
- Does `status.json` need to survive at all, or should stage diagnostics move
  to `logs/`? The dashboard reads `stageRuns`/`lastRun*` — if they're
  lose-able, `cache/status.json` is more honest.
- Recorder pointer currently has `recording: true` while pointing at a
  `dev/` file — confirm whether it's dev-session state (belongs in `dev/`) or
  a production flag the runtime must check on boot.
