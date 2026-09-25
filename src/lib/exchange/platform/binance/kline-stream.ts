import type { Kline } from "@/lib/system/types";
import { systemLog } from "@/lib/system/logging";

/**
 * Live Binance kline websocket feed shared by production runtimes.
 *
 * One combined-stream socket carries every `<symbol>@kline_<interval>`
 * subscription the engine asks for; received candles are buffered so the
 * market helper can read mark prices and closed klines without polling the
 * REST `/klines` endpoint. REST stays the fallback for history backfill —
 * the stream only ever delivers candles that close after the socket opens.
 */

export type BinanceKlineStreamMarket = "SPOT" | "FUTURES";

/** Minimal socket surface so tests can inject a fake transport. */
export interface BinanceKlineStreamSocket {
  close(): void;
  send(data: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: { code?: number }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
}

export interface BinanceKlineStreamOptions {
  marketType: BinanceKlineStreamMarket;
  /** Injectable socket factory; defaults to the runtime's native WebSocket. */
  createSocket?: (url: string) => BinanceKlineStreamSocket;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface BinanceKlineStreamStatus {
  connected: boolean;
  /** Current stream host — rotates when a socket starves or dies silent. */
  host: string;
  lastEventAt: number;
  streams: string[];
}

interface StreamBuffer {
  closed: Kline[];
  forming?: Kline;
  lastEventAt: number;
}

const MAX_CLOSED_KLINES = 1_000;
const PRUNE_AFTER_MS = 15 * 60_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/**
 * A subscribed kline stream emits every ~250ms, so an open socket that has
 * delivered nothing for this long is silently starved — either a half-dead
 * socket or a host withholding data (Binance suppresses ws per-IP without
 * erroring). The feed treats it as a disconnect and rotates hosts.
 */
const SILENT_STREAM_MS = 15_000;
const STALE_FEED_MS = 30_000;
const SUBSCRIBE_CHUNK = 50;
/**
 * Grace given to a primary feed before its fallback market takes over —
 * long enough for a healthy socket to deliver first events, short enough
 * that a suppressed host is bypassed within one probe window.
 */
const FALLBACK_ENGAGE_MS = 5_000;

const SHARED_KEY = Symbol.for("slow-trading.binance-kline-stream.instances");

const WS_HOSTS: Record<BinanceKlineStreamMarket, string[]> = {
  FUTURES: [
    "wss://fstream.binance.com",
    "wss://fstream1.binance.com",
    "wss://fstream2.binance.com",
    "wss://fstream3.binance.com",
  ],
  SPOT: ["wss://stream.binance.com:9443", "wss://stream.binance.com:443"],
};

/** Maps a runtime base symbol (`SUI` or `SUI_USDT`) to its stream name. */
function streamName(symbol: string, interval: string): string {
  const base = symbol.toLowerCase().replace(/_?usdt$/i, "");
  return `${base}usdt@kline_${interval}`;
}

/** Converts one `kline` stream event into the shared Kline tuple shape. */
function toKline(payload: any): { closed: boolean; kline: Kline } | null {
  const k = payload?.k;
  if (!k) return null;

  const openTime = Number(k.t);
  const closeTime = Number(k.T);
  if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) return null;

  return {
    closed: k.x === true,
    kline: [
      openTime,
      String(k.o ?? ""),
      String(k.h ?? ""),
      String(k.l ?? ""),
      String(k.c ?? ""),
      String(k.v ?? ""),
      closeTime,
      String(k.q ?? ""),
      Number(k.n) || 0,
      String(k.V ?? ""),
      String(k.Q ?? ""),
      String(k.B ?? ""),
      "",
    ],
  };
}

function create(options: BinanceKlineStreamOptions) {
  const now = options.now ?? (() => Date.now());
  const createSocket =
    options.createSocket ??
    ((url: string) =>
      new WebSocket(url) as unknown as BinanceKlineStreamSocket);
  const hosts = WS_HOSTS[options.marketType];

  const wanted = new Map<string, number>();
  const buffers = new Map<string, StreamBuffer>();
  const subscribed = new Set<string>();
  let hostIndex = 0;
  let socket: BinanceKlineStreamSocket | null = null;
  let socketOpen = false;
  let socketCreatedAt = 0;
  let socketOpenedAt = 0;
  let socketFailed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_BASE_MS;
  let stopped = false;
  let lastEventAt = 0;
  let subscribeId = 0;

  /** Cycles to the next stream host — a dead or suppressing host self-skips. */
  function rotateHost(): void {
    hostIndex = (hostIndex + 1) % hosts.length;
  }

  function send(payload: Record<string, unknown>): void {
    try {
      socket?.send(JSON.stringify(payload));
    } catch (error) {
      systemLog.error("Binance kline stream send failed", error);
    }
  }

  function flushSubscriptions(): void {
    const pending = [...wanted.keys()].filter((name) => !subscribed.has(name));
    for (let index = 0; index < pending.length; index += SUBSCRIBE_CHUNK) {
      const chunk = pending.slice(index, index + SUBSCRIBE_CHUNK);
      send({ id: ++subscribeId, method: "SUBSCRIBE", params: chunk });
      chunk.forEach((name) => subscribed.add(name));
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer || wanted.size === 0) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function handleClose(closed: BinanceKlineStreamSocket): void {
    // Stale transports are ignored — the path that dropped them already ran
    // cleanup, and acting again could corrupt a live replacement socket.
    if (closed !== socket) return;
    // A socket that never delivered rotates hosts — dead or suppressing
    // hosts self-skip. A socket that streamed reconnects to the same host.
    if (lastEventAt < socketCreatedAt) rotateHost();
    socket = null;
    socketOpen = false;
    subscribed.clear();
    if (!stopped) scheduleReconnect();
  }

  /**
   * Recycles a silently-dead socket — open-but-muted (Binance suppresses
   * futures ws per-IP without erroring) or stuck mid-handshake (a filtered
   * host leaves connect hanging with no open/error/close). Called on every
   * read/track so starvation is detected within one pass without a timer.
   */
  function ensureFreshSocket(): void {
    if (!socket || wanted.size === 0) return;
    const since = socketOpen ? socketOpenedAt : socketCreatedAt;
    if (now() - Math.max(lastEventAt, since) <= SILENT_STREAM_MS) return;

    const current = socket;
    socket = null;
    socketOpen = false;
    subscribed.clear();
    rotateHost();
    // Detach before close — a hung transport may never fire onclose, and
    // one that does must not re-enter cleanup for a socket already dropped.
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    current.close();
    scheduleReconnect();
  }

  function handleMessage(data: unknown): void {
    let parsed: any;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      return;
    }

    const name = typeof parsed?.stream === "string" ? parsed.stream : "";
    const mapped = toKline(parsed?.data);
    if (!name || !mapped) return;

    lastEventAt = now();
    const buffer = buffers.get(name) ?? { closed: [], lastEventAt };
    buffer.lastEventAt = lastEventAt;

    if (mapped.closed) {
      const last = buffer.closed.at(-1);
      if (last && last[0] === mapped.kline[0]) {
        buffer.closed[buffer.closed.length - 1] = mapped.kline;
      } else {
        buffer.closed.push(mapped.kline);
        buffer.closed.sort((a, b) => a[0] - b[0]);
      }
      if (buffer.closed.length > MAX_CLOSED_KLINES) {
        buffer.closed.splice(0, buffer.closed.length - MAX_CLOSED_KLINES);
      }
      if (buffer.forming && buffer.forming[0] <= mapped.kline[0]) {
        buffer.forming = undefined;
      }
    } else {
      buffer.forming = mapped.kline;
    }

    buffers.set(name, buffer);
  }

  function connect(): void {
    if (stopped || socket || socketFailed) return;

    const url = `${hosts[hostIndex]}/stream`;
    let next: BinanceKlineStreamSocket;
    try {
      next = createSocket(url);
    } catch (error) {
      // No usable transport — e.g. a runtime without native WebSocket. The
      // feed stays inert so readers degrade to the REST fallback instead of
      // track() throwing through the stage.
      socketFailed = true;
      systemLog.error(
        "Binance kline stream unavailable — REST fallback active",
        { error, url },
      );
      return;
    }
    socket = next;
    socketOpen = false;
    socketCreatedAt = now();
    socketOpenedAt = 0;
    next.onopen = () => {
      if (socket !== next) return;
      socketOpen = true;
      socketOpenedAt = now();
      reconnectDelay = RECONNECT_BASE_MS;
      flushSubscriptions();
    };
    next.onmessage = (event) => handleMessage(event.data);
    next.onclose = () => handleClose(next);
    next.onerror = () => {
      systemLog.error("Binance kline stream socket error", { url });
    };
  }

  /**
   * Closes the socket after the feed sits untracked. `wanted` and buffers
   * clear so the next `track` reconnects from a clean slate; unlike `stop`
   * the feed stays usable for one-shot consumers (manual passes).
   */
  function idleClose(): void {
    idleTimer = null;
    wanted.clear();
    buffers.clear();
    const current = socket;
    socket = null;
    socketOpen = false;
    subscribed.clear();
    current?.close();
  }

  /** Re-arms the idle window every time a consumer tracks symbols. */
  function armIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(idleClose, PRUNE_AFTER_MS);
    idleTimer.unref?.();
  }

  /** Reconciles open subscriptions against recently requested streams. */
  function reconcile(at: number): void {
    for (const [name, lastWanted] of [...wanted.entries()]) {
      if (at - lastWanted <= PRUNE_AFTER_MS) continue;
      wanted.delete(name);
      buffers.delete(name);
      if (subscribed.delete(name)) {
        send({ id: ++subscribeId, method: "UNSUBSCRIBE", params: [name] });
      }
    }
    if (socketOpen) flushSubscriptions();
  }

  function isFresh(buffer: StreamBuffer): boolean {
    return now() - buffer.lastEventAt <= STALE_FEED_MS;
  }

  return {
    /**
     * Marks streams as needed. Call every cycle — subscriptions open lazily
     * and idle streams are pruned after `PRUNE_AFTER_MS`.
     */
    track(symbols: string[], interval: string): void {
      ensureFreshSocket();
      const at = now();
      armIdleTimer();
      for (const symbol of symbols) {
        wanted.set(streamName(symbol, interval), at);
      }
      if (!socket) connect();
      reconcile(at);
    },

    /**
     * Latest live close price for a symbol, or undefined when the feed has
     * no fresh candle for it and REST should answer instead.
     */
    markPrice(
      symbol: string,
      interval: string,
    ): { lastUpdated: number; price: number } | undefined {
      ensureFreshSocket();
      const buffer = buffers.get(streamName(symbol, interval));
      if (!buffer || !isFresh(buffer)) return undefined;

      const latest = buffer.forming ?? buffer.closed.at(-1);
      if (!latest) return undefined;
      const price = Number(latest[4]);
      if (!Number.isFinite(price)) return undefined;

      return {
        lastUpdated: buffer.forming ? buffer.lastEventAt : latest[6],
        price,
      };
    },

    /**
     * Closed candles received since `openTime`, or undefined when the buffer
     * cannot cover the window (cold start or stale feed → REST backfills).
     */
    closedKlines(
      symbol: string,
      interval: string,
      sinceOpenTime: number,
    ): Kline[] | undefined {
      ensureFreshSocket();
      const buffer = buffers.get(streamName(symbol, interval));
      if (!buffer || buffer.closed.length === 0 || !isFresh(buffer)) {
        return undefined;
      }
      if (buffer.closed[0][0] > sinceOpenTime) return undefined;
      return buffer.closed.filter((kline) => kline[0] >= sinceOpenTime);
    },

    status(): BinanceKlineStreamStatus {
      return {
        connected: socketOpen,
        host: hosts[hostIndex],
        lastEventAt,
        streams: [...subscribed],
      };
    },

    stop(): void {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      const current = socket;
      socket = null;
      socketOpen = false;
      subscribed.clear();
      wanted.clear();
      buffers.clear();
      current?.close();
    },
  };
}

/** Shares one kline stream per market across every server bundle/process consumer. */
function shared(options: { marketType: BinanceKlineStreamMarket }) {
  const scope = globalThis as typeof globalThis & {
    [SHARED_KEY]?: Map<string, BinanceKlineStream>;
  };
  const registry = (scope[SHARED_KEY] ??= new Map());
  let feed = registry.get(options.marketType);
  if (!feed) {
    feed = create({ marketType: options.marketType });
    registry.set(options.marketType, feed);
  }
  return feed;
}

export type BinanceKlineStream = ReturnType<typeof create>;

/**
 * Wraps a primary feed with a fallback market's stream — e.g. spot klines
 * proxying a suppressed futures stream. Both markets carry the same
 * `<base>usdt@kline_*` names at ≈price (spot basis vs futures mark is
 * noise for stage monitoring), so readers keep getting real-time data
 * instead of dropping to REST polling while every primary host is dead.
 *
 * The fallback only spins up while the primary is silent: first delivery
 * on the primary releases it, and its streams prune + idle-close on their
 * own once nothing tracks them — the feed self-heals back to the primary.
 */
function withFallback(options: {
  primary: BinanceKlineStream;
  fallback: BinanceKlineStream;
  /** Silence window before the fallback engages. */
  engageMs?: number;
  /** Fired when the fallback engages or releases — persist/notify upstream. */
  onFallback?: (engaged: boolean) => void;
  /** Injectable clock for tests. */
  now?: () => number;
}): BinanceKlineStream {
  const now = options.now ?? (() => Date.now());
  const engageMs = options.engageMs ?? FALLBACK_ENGAGE_MS;
  const { primary, fallback } = options;
  let proxyEngaged = false;
  let silentSince: number | null = null;

  /** Whether the primary cannot serve: never delivered, or went stale. */
  function primarySilent(): boolean {
    const status = primary.status();
    if (status.lastEventAt > 0) {
      silentSince = null;
      return now() - status.lastEventAt > STALE_FEED_MS;
    }
    // Never delivered — only counts after the socket had a fair window.
    silentSince ??= now();
    return now() - silentSince >= engageMs;
  }

  function evaluate(): boolean {
    const silent = primarySilent();
    if (silent === proxyEngaged) return silent;
    proxyEngaged = silent;
    if (silent) {
      systemLog.error("Primary kline stream silent — fallback stream engaged");
    } else {
      systemLog.info("Primary kline stream recovered — fallback released");
    }
    options.onFallback?.(silent);
    return silent;
  }

  return {
    track(symbols, interval) {
      primary.track(symbols, interval);
      if (evaluate()) fallback.track(symbols, interval);
    },
    markPrice(symbol, interval) {
      const direct = primary.markPrice(symbol, interval);
      if (direct) return direct;
      if (evaluate()) fallback.track([symbol], interval);
      return fallback.markPrice(symbol, interval);
    },
    closedKlines(symbol, interval, sinceOpenTime) {
      const direct = primary.closedKlines(symbol, interval, sinceOpenTime);
      if (direct) return direct;
      if (evaluate()) fallback.track([symbol], interval);
      return fallback.closedKlines(symbol, interval, sinceOpenTime);
    },
    status() {
      const status = proxyEngaged ? fallback.status() : primary.status();
      return {
        ...status,
        host: proxyEngaged ? `${status.host} (fallback)` : status.host,
      };
    },
    stop() {
      primary.stop();
      fallback.stop();
    },
  };
}

const binanceKlineStream = { create, shared, withFallback } as const;

export default binanceKlineStream;
