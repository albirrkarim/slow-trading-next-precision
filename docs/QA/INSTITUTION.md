# Institutional Comparison

Scope: how close PRECISION is to institutional trading operations — not the
strategy (see `QUANT.md`) but the *plumbing*: execution, risk overlays,
reconciliation, treasury, monitoring, uptime, and process discipline.
Institutions wrap many trading desks in firm-level layers; the honest framing
is that **PRECISION is a desk, not a firm**.

**Overall: 62 / 100 as desk-level operations. The firm-level layer is absent —
mostly by design, partly by omission.**

## Score breakdown

| Area | Score | Notes |
|---|---|---|
| Risk controls & kill chains | 13/15 | Layered: daily-PnL entry stop, black-swan breadth detector → forced exits, per-symbol auto-remove, max positions, margin caps, reserve accounting. Desk-grade. |
| Reconciliation & audit trail | 12/15 | Exchange-as-source-of-truth sync, confirmed futures exits with residual sweep, config-change log, management log, withdrawal log, persisted trade reasons. This *is* what recon teams do. |
| Security & secrets | 9/10 | Per `SECURITY.md` (85/100): AES-256-GCM creds at rest, scoped MCP tokens, PIN + HMAC sessions. |
| Treasury / counterparty | 8/10 | Scheduled auto-withdrawals sweep exchange balance to external wallets — genuine counterparty-risk mitigation most retail bots never build. Still single-venue. |
| Process & change management | 6/10 | Spec docs + TC markers + QA assessments + quality gate — real discipline, but solo review, no separate approval step. |
| Monitoring & alerting | 6/10 | n8n/email/telegram notifications with dedupe, error logs, IP-change detection, `monitor-process.mjs` watchdog. No paging/on-call rotation (solo). |
| Execution & venue infra | 6/15 | REST polling at 1–5 min, market orders, no execution algos (TWAP/limit ladders), single venue, retail fee tier. Honest for the cadence — but a firm would call this "no execution desk." |
| Data quality | 4/10 | Public klines only — no tick/order-book data, no point-in-time guarantees, delisting risk unmodeled. |
| Uptime & failover | 3/10 | Runner bootstraps on server start + process monitor, but single container — if Railway dies mid-position, nothing owns the book until restart. |
| Compliance / reporting | N/A | Excluded — personal capital, no investors, no regulator. |

## Strengths (verified in code)

- **The kill chain is real, layered, and tested** — `AUTO_ENTRY_DAILY_PNL_LIMIT_USDT`
  pauses entries on realized daily loss, the black-swan breadth detector
  schedules emergency exits and recovers after cooldown, `autoRemoveSymbol*`
  retires bad coins. Institutional desks call this the "limits framework."
- **Recon discipline most bots skip** — position size/margin re-synced from
  the exchange (`SYNC_ENTRY_POSITION_FROM_EXCHANGE`), externally-closed
  positions detected (`[CLOSED_ON_EXCHANGE]`), exits confirmed on-exchange
  with reduceOnly + residual sweep, and failed exits restored from snapshot
  instead of assumed closed.
- **Audit trail exists** — config-change log, management-action log,
  withdrawal log, error logs, persisted `lastMonitoringStage` + classification
  reason on every position, notification dedupe store. Trade reconstruction
  is feasible from persisted state.
- **Treasury function** — scheduled withdrawal queues to a wallet book mean
  profit doesn't sit at exchange counterparty risk forever. This is the
  closest thing to a prime-broker/custody separation a solo setup can have.
- **API-usage ops** — the request coordinator budgets Binance
  `X-MBX-USED-WEIGHT` headers, coalesces shared reads, backs off on
  cooldown — a rate-limit-aware execution envelope, not naive polling.
- **Account isolation** — sequential per-account execution, per-account
  private state, combined MCP balance — book segregation like desks inside
  a firm.

## What institutions have that PRECISION lacks — and whether it matters

- **Execution algos & venue access** (TWAP/VWAP, iceberg, smart routing,
  multiple venues, negotiated fees). *Partially matters*: at 1–5 min
  cadence with small size, market orders are defensible — but on thin coins
  the 24h-volume cap is the only protection against self-impact.
- **Portfolio-level risk model** (VaR/ES, factor exposure, correlation
  limits, stress tests). *Matters*: every risk control is per-position or
  per-day-PnL; nothing asks "what if all 8 positions average against a
  correlated -40% day" — the black-swan detector is the only portfolio-
  level guard and it watches market breadth, not portfolio greeks.
- **Failover & book ownership** (hot standby, state handoff, "who owns
  the book when the runner is down"). *Matters*: a dead container leaves
  open positions unwatched — no SL/TP exists on-exchange as a safety net,
  so downtime = unprotected exposure. This is the single most
  institutional gap worth fixing.
- **Data depth** (tick feeds, order book, point-in-time datasets).
  *Mostly doesn't matter* for a volatility-pivot strategy on 1–5 min
  cadence.
- **Separation of duties** (risk desk can veto trader, dev can't touch
  prod, two-person rule on transfers). *Mostly N/A* — solo operator; the
  sandbox mode + spec/TC discipline is the reasonable solo equivalent.
- **Compliance, investor reporting, capital-raising infra**. *N/A.*

## The desk-not-firm verdict

PRECISION's weakest institutional axes — execution algos, data depth,
compliance — are also the least relevant to its niche. Its strongest axes
(kill chains, recon, audit, treasury sweeps) are exactly the ones retail
bots usually lack. **The pattern is inverted from a typical retail bot:
strong ops, retail-grade venue access.**

The two gaps worth real money:

1. **Exchange-side safety net during downtime** — resting reduce-only
   stop orders on Binance so a dead container can't leave a fully-averaged
   position naked. Institutions would call this "the book must be protected
   even when the process is dead."
2. **Portfolio-level exposure limit** — a correlated-drawdown check across
   open positions (e.g., total locked margin vs. account equity, worst-case
   simultaneous stop loss) beyond the per-position and daily-PnL guards.
