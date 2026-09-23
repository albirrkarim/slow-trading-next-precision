# API surface — redesign

The API layer still carries legacy naming. This document defines the target
route tree and client endpoint registry. Safe to rename freely: the system is
not deployed, no external consumers exist except the `debug/export|import`
sync token flow.

## Current problems

1. **The registry lies about environments.** `endpoints.slow.prod` is not
   "production" — it is the `/api/slow-trading/*` route family.
   `endpoints.slow.dev` is not "development" — it is `/api/dashboard/*`
   market data called by the live dashboard (`LiveDashboardPage`,
   `TradeChartBase`, `KlinesCard`). `endpoints.dev` is a third meaning:
   `/api/dev/*` dev-tool pages.
2. **Prefix names are legacy.** `slow-trading` predates the Precision rename;
   `dashboard` holds market data, not dashboard state.
3. **Flat pseudo-namespaces.** `balance-refresh`, `balance-snapshots`,
   `black-swan`, `black-swan-preview`, `entry`, `entry-diagnostics`,
   `binance-cooldown-reset` encode grouping in hyphens instead of folders.
4. **The registry is not exhaustive.** `/api/pin`, `/api/pin/logout`,
   `/api/mcp`, `debug/export`, `debug/import` have no entries; `ButtonLogout`
   and `PinClient` hardcode URL literals.
5. **`proxy.ts` carries dead matchers** (`/slow/*`, `/dev/dynamic-trade/*`,
   `/dev/coins/*`) for pages that no longer exist.

## Target route tree

```text
src/pages/api/
  system/                           (was slow-trading/)
    state.ts                        (was storage.ts)
    history.ts
    logs.ts
    queue.ts
    reset.ts
    withdraw.ts
    quick-backtest.ts
    mcp-tokens.ts
    notification-test.ts
    precision-test-case.ts
    balance/
      refresh.ts                    (was balance-refresh.ts)
      snapshots.ts                  (was balance-snapshots.ts)
    action/
      entry.ts                      (was entry.ts)
      exit.ts                       (was exit.ts)
      diagnostics.ts                (was entry-diagnostics.ts)
    coin/
      metadata.ts                   (was coin-metadata.ts)
    black-swan/
      index.ts                      (was black-swan.ts)
      preview.ts                    (was black-swan-preview.ts)
    account/
      index.ts                      (was exchange-accounts.ts)
    exchange/
      cooldown-reset.ts             (was binance-cooldown-reset.ts)
    debug/                          (unchanged folder)
      broadcast-coin-metadata.ts
      export.ts
      import.ts
      sync-local-to-online.ts
      sync-online-coin-metadata-to-local.ts
      sync-online-to-local.ts
  market/                           (was dashboard/)
    funding-rates.ts
    initialize.ts
    klines.ts
    volatility.ts
  dev/                              (unchanged)
    backtest-precision/index.ts
    precision-checker/index.ts
  pin.ts, pin/logout.ts             (unchanged)
  mcp.ts, mcp/[token].ts            (unchanged)
```

Prefix vocabulary: `system` = the app's operational API (state, actions,
settings — mirrors `lib/system`), `market` = exchange-derived data feeds,
`dev` = dev-tool pages, `pin` = auth, `mcp` = external integration.

## Target endpoint registry

Registry key path mirrors the URL path — `endpoints.system.balance.refresh`
reads as `/api/system/balance/refresh`:

```ts
const endpoints = {
  system: {
    state, history, logs, queue, reset, withdraw, quickBacktest,
    mcpTokens, notificationTest, precisionTestCase,
    balance:  { refresh, snapshots },
    action:   { entry, exit, diagnostics },
    coin:     { metadata },
    blackSwan:{ state, preview },
    account:  { list },
    exchange: { cooldownReset },
    debug:    { broadcastCoinMetadata, export: exportData, import: importData,
                syncLocalToOnline, syncOnlineCoinMetadataToLocal,
                syncOnlineToLocal },
  },
  market: { fundingRates, initialize, klines, volatility },
  dev:    { backtestPrecision, precisionChecker },
  pin:    { login, logout },
  mcp,
};
```

Base constants collapse to `const API = "/api"` plus per-family prefix
constants (`SYSTEM = "${API}/system"`, …). `PRODUCTION_DOMAIN` stays `""`.

## Rules

- Bucket names are route prefixes, never environments. There is no
  `prod`/`dev` inside a family — environment is deployment config.
- Every route the UI calls has a registry entry; no `/api/` literals in
  components (fix `ButtonLogout`, `PinClient`).
- Routes consumed only by external tooling (`debug/export`, `debug/import`)
  still get registry entries — the catalog is the single map of the surface.
- `proxy.ts` auth boundaries track prefixes: protect `/api/system/*` (keep
  the `coin-metadata` exception), drop dead page matchers, rename the sync
  header `x-slow-sync-token` → `x-sync-token`.

## Phases

### Phase 1 — market data prefix — [ ]

- [ ] `pages/api/dashboard/*` → `pages/api/market/*` (4 routes).
- [ ] Registry: `slow.dev` → `market`; repoint `LiveDashboardPage`,
      `TradeChartBase`, `KlinesCard` (~7 call sites).

### Phase 2 — system prefix + grouping — [ ]

- [ ] `pages/api/slow-trading/*` → `pages/api/system/*` with the nested
      folders above (`balance/`, `action/`, `coin/`, `black-swan/`,
      `account/`, `exchange/`); `storage.ts` → `state.ts`.
- [ ] Registry: `slow.prod` → `system` with nested groups; repoint ~35
      call sites (dashboard page, navbar, settings dialogs, tests).
- [ ] Route-internal imports updated; no legacy path strings remain.

### Phase 3 — registry exhaustiveness — [ ]

- [ ] Add `pin.{login,logout}` and `mcp` entries; repoint `ButtonLogout`,
      `PinClient`.
- [ ] Add `system.debug.{export,import}` entries (external-tool routes).

### Phase 4 — proxy cleanup — [ ]

- [ ] Matcher + `isProtectedPath`/`isProtectedApiPath` move to
      `/api/system`; drop `/slow/*`, `/dev/dynamic-trade/*`, `/dev/coins/*`.
- [ ] `isSlowSyncTokenPath` → new debug paths; rename sync token header.
- [ ] Preserve the `coin-metadata` auth exception.

## Verification

- [ ] `npm run type` and `npm run quality` after each phase.
- [ ] Final sweep: zero `slow-trading`/`/api/dashboard/` literals in `src/`;
      every `pages/api` route reachable via `endpoints` or documented as
      external-only.
