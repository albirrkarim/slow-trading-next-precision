# Binance REST Runtime Budget and Health

This document is the source of truth for Binance REST activity produced by the
SLOW live runtime. It covers scheduled stages, dashboard reads, execution, the
request coordinator, and cooldown health. All cadences below are defaults;
positive whole-minute runtime settings can override stage intervals.

## 1. Incident assessment (13 September 2026)

The production monitoring snapshot contained 67 cooldown errors. They were
distributed as follows:

| Source | Count |
| --- | ---: |
| `slow-trading.dashboard.live-balance` | 49 |
| `runner.tick.speedup` | 7 |
| `runner.tick.risk-sentinel` | 7 |
| `cycle.account.1` | 2 |
| `runner.tick.standard-monitoring` | 1 |
| `runner.tick.capture-entry` | 1 |

The important signature was repeated calls during the same Binance ban. For
example, Speedup calls at 00:27Z and 00:43Z both received the same
`banned until 1789268394983` response. Dashboard balance failures continued in
pairs and approximately every ten minutes while the ban was already active.
Later probes first created a short ban and then extended it to more than three
hours.

Root cause: the coordinator's queue, request-weight counters, and cooldown were
module-local variables. Next.js server route bundles, process reloads, or other
runtime workers could therefore load separate coordinator instances. A route
that did not know another route had entered cooldown called Binance again,
rediscovered the same ban, emitted another error/notification, and could extend
the IP ban. The paired probes are consistent with the two enabled account
balance reads and can be multiplied further by multiple dashboard clients.

The fix makes coordinator state process-wide and makes cooldown state
persistent. Every REST request hydrates the persisted gate before its callback
is allowed to execute. Private balance is now lazy: monitoring evaluates exits
and averaging candidates first, then fetches balance only when funds are
actually needed for entry or averaging authorization.

TC: `PROD:BINANCE_PERSISTENT_COOLDOWN`

TC: `PROD:BINANCE_BALANCE_REQUEST_BUDGET`

TC: `PROD:LAZY_BALANCE_REFRESH`

## 2. Scheduled stages and collision rules

| Stage | Default cadence | Binance work |
| --- | ---: | --- |
| Risk Sentinel / Black Swan | 1 minute | BTC 1m candles. Breadth candles only after BTC warning evidence. |
| Speedup | 1 minute | Market preparation and monitoring for positions matching a Speedup rule. |
| Standard Monitoring | 5 minutes | Market preparation and monitoring for open positions not owned by Speedup. |
| Management | 5 minutes | Stored volatility/market metadata rules; any refresh it invokes still uses the coordinator. |
| Capture Entry | 5 minutes | Market preparation, entry analysis, and possible order execution. |

The runner dispatches each due stage in a fixed order — risk sentinel, speedup,
standard monitoring, management, capture entry — and every stage run
serializes through the engine's single run queue, so stages never overlap one
another or an operator-triggered pass. A position is assigned to Speedup or
Standard Monitoring, never both, for one classification pass.

Inside a stage, the Binance request coordinator serializes the actual REST
callbacks, observes request weight, and enforces the shared persistent cooldown
before any callback. Black Swan evidence is shared once across all accounts.

TC: `BOTH:SPEEDUP_STAGE`

TC: `BOTH:STANDARD_MONITORING_STAGE`

TC: `PROD:BINANCE_REQUEST_COORDINATOR`

## 3. Black Swan request cadence

- BTC is checked on every enabled Risk Sentinel pass: every 1 minute by
  default (`blackSwanStageIntervalMinutes`).
- The request is one 1-minute kline window from the previous 65 minutes, with
  `limit=70`.
- The BTC candle promise/value is cached for 55 seconds, coalescing live and
  sandbox consumers inside that freshness window.
- Breadth is not fetched during normal BTC conditions.
- If the first BTC evaluation reaches a warning threshold, configured symbols
  other than BTC are fetched using the same 1-minute/65-minute/70-candle shape.
- Breadth uses at most four application workers, but all resulting Binance REST
  callbacks still pass through the single coordinator queue.

Thus Black Swan normally costs one kline request per minute: futures weight 1
or spot weight 2 for `limit=70`. Its exceptional warning path costs up to one
additional request at the same weight per non-BTC configured symbol.

TC: `PROD:BLACK_SWAN_SHARED_EVIDENCE`

## 4. Cycle request inventory

Public market preparation is performed once per stage and reused sequentially
by all enabled accounts. In production the shared kline websocket feed (§10)
serves steady-state mark prices and closed candles; REST `/klines` only
backfills windows the stream cannot cover, and remains the sole path in
backtests.

| Runtime operation | Endpoint or adapter call | When/cadence | Cache/coalescing |
| --- | --- | --- | --- |
| Runtime mark price (per-symbol latest trade close, not the exchange's index mark) | Kline websocket forming-candle close (§10); REST `/klines` fallback per symbol | Each eligible stage cycle for every selected symbol | Shared stream buffer; REST only for uncovered or stale symbols |
| Volatility synchronization | Kline websocket closed candles (§10); REST `/fapi/v1/klines` or `/api/v3/klines` only when the stream buffer cannot reach the requested `startTime` | Once for each selected symbol in each eligible stage cycle; incremental range is decided by stored prediction memory | Shared stream buffer plus prediction-memory throttling |
| Stage clock candle | Klines for the first selected symbol, 5m interval | Each eligible stage cycle | Until the next aligned 5-minute boundary |
| Position-sync price | Klines, 5m interval | Each selected live open-position symbol before private position reconciliation | 5-second per-symbol latest-price cache plus stage single-flight |
| Reporting price | Klines, 5m interval | Each monitored position symbol | Separate 5-second per-symbol cache plus stage single-flight |
| Latest kline context | Klines through the shared latest-kline loader | Capture-entry preparation | Stage-shared result |
| Funding rate | Futures `/fapi/v1/premiumIndex` without a symbol | When futures reporting needs funding | One all-symbol response cached 5 minutes |
| 24-hour volume | Futures `/fapi/v1/ticker/24hr` or spot `/api/v3/ticker/24hr` without a symbol | Entry context/dashboard initialization | One all-symbol response cached 10 minutes and persisted |
| Entry authorization balance | Futures `/fapi/v2/balance` or spot `/api/v3/account` | Once per live account pass only when at least one entry signal survives the final guards | Reused by all serialized entry candidates; local value is adjusted after each successful order |
| Averaging authorization balance | Same balance endpoint | Once per live monitoring pass only when at least one averaging candidate exists | Reused by all serialized averaging candidates; no call for exit-only or ordinary monitoring |
| Open futures positions | `/fapi/v2/positionRisk` | Live futures account cycle with selected open positions | Once per account pass |
| Final account balance | Same balance endpoint | Only after a report confirms `BUY` or `SELL` | Skipped for monitoring-only/no-order cycles |

Empty monitoring stages do no public or private exchange I/O.

With multiple accounts, public market preparation remains one shared stage
snapshot. Balance and position-risk requests remain private and execute
sequentially. Position risk is synchronized when required by live futures
positions. Balance is not periodic: it is requested only at an entry/averaging
authorization boundary and after a successful order.

TC: `PROD:SHARED_MARKET_SINGLE_FLIGHT`

TC: `PROD:MULTI_ACCOUNT_SEQUENTIAL_CYCLE`

TC: `PROD:EMPTY_MONITORING_NO_MARKET_IO`

TC: `PROD:LAZY_BALANCE_REFRESH`

## 5. Order and account-operation requests

These requests are conditional rather than periodic:

| Operation | Binance endpoint(s) | Trigger |
| --- | --- | --- |
| Futures order | `/fapi/v1/order` | Confirmed entry, averaging, exit, or forced exit |
| Futures leverage/margin setup | `/fapi/v1/leverage`, `/fapi/v1/marginType` | Futures execution setup when required |
| Spot order | `/api/v3/order` | Confirmed spot entry or exit |
| Open orders | `/fapi/v1/openOrders` where used | Order reconciliation/cancellation flow |
| Execution price context | Klines | Entry, averaging, and exit calculations when the execution module requires a current candle |
| Account permissions | `/sapi/v1/account/apiRestrictions` | Withdrawal capability validation |
| Asset/network config | `/sapi/v1/capital/config/getall` | Withdrawal/network validation |
| Internal transfer | `/sapi/v1/asset/transfer` | Funding-account transfer required by withdrawal flow |
| Withdrawal submission | `/sapi/v1/capital/withdraw/apply` | Confirmed manual or scheduled withdrawal |
| Margin account/order calls | `/sapi/v1/margin/*` | Margin-mode operations only |

All calls above, including direct derivatives analytics, use the same public or
private Binance request helper and therefore the same queue and cooldown gate.

## 6. Dashboard requests

- The dashboard storage endpoint loads once on page load and then every
  10 minutes per open browser client, but its balance values come only from
  persisted runner memory. Opening, reloading, or polling the dashboard does
  not request a private Binance balance.
- Each enabled live account has a small manual balance-refresh control in the
  navbar. One click makes one private balance request for that account, updates
  its persisted live memory, and reloads the storage-backed dashboard state.
- Manual balance refresh is unavailable for sandbox accounts and while the
  persistent Binance cooldown is active.
- It requests a small 1-minute kline set for each distinct open-position symbol
  to refresh floating PnL. Those callbacks are also blocked during cooldown.
- Dashboard initialization can refresh the 24-hour all-symbol ticker snapshot
  (10-minute cache), the funding snapshot (5-minute cache), and volatility data
  when stale.

Browser clients do not own request coordination. Their server-side Binance
callbacks all join the process-wide queue and read the persistent cooldown gate.

TC: `PROD:DASHBOARD_PERSISTED_BALANCE`

TC: `PROD:MANUAL_ACCOUNT_BALANCE_REFRESH`

## 7. Coordinator weight budget

The coordinator estimates the request weights used by this application:

| Endpoint | Estimated weight |
| --- | ---: |
| Futures klines, `limit < 100` / `< 500` / `<= 1000` / greater | 1 / 2 / 5 / 10 |
| Spot klines | 2 |
| Futures 24h ticker, symbol / all symbols | 1 / 40 |
| Spot 24h ticker, symbol / all symbols | 2 / 80 |
| Futures premium index, symbol / all symbols | 1 / 10 |
| Futures balance | 5 |
| Futures position risk | 5 |
| Futures open orders, symbol / all symbols | 1 / 40 |
| Spot account | 20 |
| SAPI default | 10 |

The working limits are 2,400 weight/minute for the futures host and 6,000 for
the spot host. The base inter-request gap is 350ms. At 70% observed/estimated
usage it increases to 1 second; at 85% it increases to 2 seconds; at 90% the
request waits for the next minute window. `X-MBX-USED-WEIGHT-1M` response values
raise the coordinator's local observed usage when they exceed its estimates.

## 8. Persistent cooldown health

HTTP 418, HTTP 429, or Binance code `-1003` activates a hard gate. For a real
IP ban — HTTP 418 or a parsed `banned until` epoch — the gate end is the
exchange-communicated end plus a fixed **10-minute spare settle window**, so
the first post-ban burst cannot instantly re-trigger a longer ban. For any
other rate-limit response the gate end is the maximum of the `Retry-After`
header, the `banned until` epoch in Binance's message, and the two-minute
fallback, with no spare time. No public or private REST callback may run while
the gate is active.

Cooldown incidents are stored compactly in
`prod/logs/binance_cooldowns.json`, bounded to 500 entries. One continuous ban
is one incident. Repeated detections update its latest end/reason/endpoint and
increment `occurrences` instead of creating notification spam. Each incident
stores:

- `t`: first detection time;
- `end`: latest allowed retry time (includes the spare settle window);
- `banEnd`: exchange-communicated ban end when Binance provided one (before spare);
- `settle`: spare settle milliseconds appended after a real ban;
- public/private request kind and endpoint;
- exact Binance reason, optional error/HTTP code, and occurrence count.

The Live Dashboard places **Binance REST Health** immediately below Black Swan
status. An active cooldown shows its start and end explicitly in Jakarta time,
remaining duration, trigger, exact reason, and recent incident logs. For bans
the card distinguishes the exchange's own ban end from the local gate reopen:
the chip reads **COOLDOWN** while the exchange ban runs and switches to
**SETTLING** during the spare window; the body lists "Ban end" and "Requests
resume (+Nm spare)". Incident rows show a `+Nm spare` marker when settle was
applied, and cooldown notifications append a spare-time line for bans. MCP
monitoring snapshots include the same bounded cooldown logs (with `banEndAt`
and `settleMs`) when `logs` is requested.

An operator can manually reset an active cooldown from the dashboard after
changing the public IP. The reset clears the in-memory gate and request-weight
window, ends any active persisted incidents at the reset time, and retains the
incidents in the health history. A later Binance rate-limit response activates
a new cooldown normally.

TC: `PROD:BINANCE_GLOBAL_COOLDOWN`

TC: `PROD:BINANCE_PERSISTENT_COOLDOWN`

TC: `PROD:BINANCE_MANUAL_COOLDOWN_RESET`

TC: `PROD:BINANCE_BAN_SETTLE`

## 9. Position-monitoring health

Every open position displays a visible warning when its latest successful
Speedup/Standard monitoring timestamp is more than 10 minutes old. A new
position without a successful monitoring timestamp receives the same 10-minute
grace period measured from its opening time; after that it displays the missing
monitoring warning. The tooltip shows the last timestamp and elapsed minutes.
This is a health signal: it does not itself mutate or close a position.

TC: `PROD:OPEN_POSITION_STALE_MONITORING_WARNING`

## 10. Live kline websocket feed

Steady-state candle reads in production stream over one Binance websocket
instead of polling REST `/klines`. The feed is a process-level singleton shared
by the engine, one-shot manual passes, and diagnostics; it connects lazily on
the first `track` call and idle-closes after 15 minutes without one, so engine
restarts and manual passes never leak connections.

The feed's `markPrice` is the forming futures kline's trade-close that fills
the runtime `markPriceMap` — not Binance's `@markPrice` stream, the
index-based mark used for funding and liquidation.

| Concern | Behavior |
| --- | --- |
| Streams | `<base>usdt@kline_<interval>` on one combined-stream socket; futures uses the documented market-data base `wss://fstream.binance.com/market` (combined path `/stream`), spot rotates `stream.binance.com:9443` → `:443` |
| Subscriptions | `track(symbols, interval)` marks wanted streams on every market update; streams unrequested for 15 minutes are unsubscribed and their buffers dropped |
| Buffer | Latest forming candle plus up to 1,000 closed candles per stream |
| Reconnect | On socket close, resubscribes every wanted stream after a 1-second backoff that doubles up to 30 seconds |
| Staleness | A stream with no event for 30 seconds counts as dead; its readers fall back to REST |
| Silent starvation | An open socket that delivers nothing for 15 seconds — or a handshake that never completes — is force-closed and reconnected. Futures has a single documented host, so the watchdog reconnects to the same host; spot rotates between its two hosts |
| No spot proxy | Spot klines are a different market — spot candles are never used for futures price or volatility decisions, and there is no cross-market proxy. A symbol the stream cannot serve falls back to REST per symbol |

Consumers in `helper/market.ts`:

- `updateMarkPrice` writes `markPriceMap` from the forming candle's live close
  with event-time `lastUpdated` — fresher than the previous latest-closed-kline
  close. A symbol the feed cannot serve falls back to REST klines, so cold
  starts, new symbols, and stale streams degrade to the old behavior instead
  of failing the stage.
- `updateVPointsMap` consumes buffered closed candles. When the buffer cannot
  reach the requested `startTime` (cold start, long gap, or a fresh symbol's
  multi-month lookback) REST backfills the window once and the stream takes
  over from there.

Backtests never wire the feed — `adapter.market.live` is undefined and every
read resolves through `getKlines` exactly as before. In production the feed is
created only for the Binance exchange type. The websocket is unaffected by the
REST cooldown gate, so mark prices and volatility detection keep flowing while
a REST ban is active.

TC: `PROD:MARKET_LIVE_FEED`
