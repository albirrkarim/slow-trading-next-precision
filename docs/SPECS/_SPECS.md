# Specification

I need to know the current system behavior, for checking up. make sure AI dont mess up in the future. So i write here the current behavior.

This behavior must be tested. because it is my strategy

Both test file and the code must have commented testing code like this:

```typescript
// BOTH:MONITORING_OPEN_POSITION

// BTEST:MONITORING_OPEN_POSITION

// PROD:MONITORING_OPEN_POSITION
```

Information:

- The `TC`is short name for testing code.

- Prefix `BOTH:` is behavior that must be exist on backtest and production
  it mean the testing will be twice, because it testing the backtest and the production code. where the code of having the prfix `BOTH:` is defined.

- Prefix `BTEST:` is behavior that must be exist in backtest only

- Prefix `PROD:` is behavior that must exist in the production/runtime SLOW flow,
  not in the backtest flow.
  It may apply to live mode, sandbox mode, or both, depending on the TC name.
  For example, `PROD:*_SANDBOX` means the production/runtime sandbox mode.

## Where the behavior lives now

After the Precision rebuild, one shared runtime engine drives backtest,
sandbox, and live. The spec sections map to these roots:

| Spec | Implementation |
|---|---|
| Runtime behavior (A) | `src/lib/precision/` (shared engine), `src/lib/production/` (live/sandbox adapter) |
| Trading features (B) | `src/lib/system/trading/` (entry, averaging, exit, reserve, reporting) |
| Storage (C) | `src/lib/system/storage/` — account-scoped under `storage/persistent/instances/[PORT]/{prod,dev}/` |
| Notification (D) | `src/lib/system/notification/` — `central` port + `delivery` wired at `src/instrumentation.ts` |
| Logging (E) | `src/lib/system/logging/`, `src/lib/system/storage/logs.ts` |
| Debugging (F) | `src/lib/dev/` surfaces behind `/dev/*` pages |
| Decision engine (H) | Dissolved — Multi is the default strategy inside `src/lib/system/trading/` |
| Production cycle (I) | `src/lib/production/stages.ts` + `src/lib/precision/monitoring/` |

Tests live under `src/__dev__/main/quality/` (`unit/`, `specs/`, `ui/`,
`precision/`). TC markers are still written in source and test files.

## A. Runtime Behavior

readmore `RUNTIME.md`

## B. Trading Features

readmore `TRADING.md`

## C. Storage

readmore `TECHNICAL/STORAGE.md`

## D. Notification

readmore `NOTIFICATION.md`

## E. Logging

readmore `LOGGING.md`

## F. Debugging

readmore `DEBUGGING.md`

## H. Decision Engine

readmore `DECISION_ENGINE.md`

## I. Production Cycle Architecture

readmore `CYCLE.md`
