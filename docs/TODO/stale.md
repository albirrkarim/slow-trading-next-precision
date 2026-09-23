# Stale Spec / Marker Audit

Findings from the cross-spec TC audit (`docs/SPECS/`) after the Precision
rebuild. `BOTH:` means the behavior must exist in backtest AND production;
`PROD:` means production runtime only (live and/or sandbox).

## Documented but not implemented in any mode

- [x] `BOTH:SAFE_HAVEN_QUEUE` + `PROD:WITHDRAW_QUEUE` +
  `PROD:SAFE_HAVEN_SCHEDULE_QUEUE` (RUNTIME.md) — implemented:
  `runtimeQueue.process.run` (`system/queue/process.ts`) runs inside the
  production management stage every ~5 minutes. It auto-queues due Safe Haven
  and withdrawal schedules (`autoEnabled` + monthly `isDue`, per-mode/per-month
  dedupe via `lastQueuedAt`), then processes pending items Safe Haven first:
  partial moves bounded by `minimalAssetOnTrade` and the averaging reserve,
  waiting items carry `lastAttemptAt`/`nextAttemptAt`/`lastMessage`, identical
  failure messages are logged once, funded live withdrawals reuse the stable
  `clientWithdrawId`, sandbox withdrawals complete as bookkeeping only, and
  `balance.safeHavenRequest` is resynced to pending totals. Marker relabeled
  to `PROD:` (queue processing is production-only; the balance fields remain
  shared). Covered by `specs/queue-process.test.ts`.


