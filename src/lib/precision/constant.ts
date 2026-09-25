/**
 * How many minutes of klines `updateMarkPrice` fetches to resolve the latest
 * mark price. Only the newest closed kline in the window is used — the window
 * just needs to be wide enough that a closed kline always exists, even when
 * the feed has short gaps or the current interval's candle is still open.
 */
export const MARK_PRICE_LOOKBACK_MINUTES = 30;

/**
 * Fallback lookback (2 months, in minutes) for `updateVPointsMap` when a
 * symbol has no known vPoints yet: detection replays this much kline history
 * to rebuild the volatility-point chain from scratch.
 *
 * Once `state.vPointsMap[symbol]` has points — seeded from persisted
 * volatility files on production boot, or accumulated at runtime — detection
 * resumes from the last point's `t` instead, so this lookback only applies to
 * symbols that have never produced a point.
 */
export const VPOINT_INITIAL_LOOKBACK_MINUTES = 60 * 24 * 30 * 2;

/**
 * Default number of recent vPoints kept per symbol in
 * `state.vPointsMap` when the adapter does not set `retainRecentVPoints`.
 * Older points are dropped unless an open position still depends on them.
 */
export const DEFAULT_RECENT_VPOINTS = 10;

/**
 * Grace window before a wired live feed's miss is recorded as an error.
 * Kline events arrive within seconds once the socket is subscribed, so a
 * miss surviving past this window means the stream is genuinely stale or
 * dead and REST is carrying the stage.
 */
export const LIVE_FEED_MISS_GRACE_MS = 2 * 60_000;

/**
 * Re-log cadence while a live-feed miss persists. Bounds the error-log
 * volume to one entry per symbol per half hour during a sustained outage.
 */
export const LIVE_FEED_MISS_REPEAT_MS = 30 * 60_000;

/**
 * How long the on-start check waits for the websocket feed to serve every
 * tracked symbol before calling it failed. A healthy socket connects and
 * receives first kline events within seconds; the bound only bites when the
 * feed is dead or the transport is missing.
 */
export const LIVE_FEED_PROBE_TIMEOUT_MS = 15_000;

/** Poll interval between live-feed readiness reads during the on-start check. */
export const LIVE_FEED_PROBE_POLL_MS = 500;
