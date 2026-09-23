# Stale Spec / Marker Audit

Findings from the cross-spec TC audit (`docs/SPECS/`) after the Precision
rebuild. `BOTH:` means the behavior must exist in backtest AND production;
`PROD:` means production runtime only (live and/or sandbox).

## Documented but not implemented in any mode

- [ ] `BOTH:SAFE_HAVEN_QUEUE` + `PROD:WITHDRAW_QUEUE` +
  `PROD:SAFE_HAVEN_SCHEDULE_QUEUE` (RUNTIME.md) — audited: the queue is
  write-only. `system/queue` persists items and the dashboard renders them, but
  nothing in `production/` processes them: no scheduled pass calls
  `isDue`/`executeSchedule`, `balance.safeHavenRequest` is never consumed,
  `autoEnabled` is never evaluated, and `lastAttemptAt`/`nextAttemptAt` are
  never updated. `runtimeWithdrawal.schedules.execute` bypasses the queue
  entirely (manual API only, 2 USDT cap). The dashboard copy claiming "the
  production runner checks pending work every five minutes" is false. Decision
  needed: implement the queue-processing stage, mark the spec sections as
  planned, or remove them as legacy. If kept, `BOTH:SAFE_HAVEN_QUEUE` should
  also become `PROD:` (spec text scopes it to "live and sandbox modes").


