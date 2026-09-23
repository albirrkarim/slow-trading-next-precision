# Stale Spec / Marker Audit

Findings from the cross-spec TC audit (`docs/SPECS/`) after the Precision
rebuild. `BOTH:` means the behavior must exist in backtest AND production;
`PROD:` means production runtime only (live and/or sandbox).

No open items remain. The Safe Haven/withdrawal queue processor
(`runtimeQueue.process.run`) is implemented and covered by
`specs/queue-process.test.ts`.
