import production from "@/lib/production";
import type { RuntimeContext } from "@/lib/precision/types";
import type {
  RuntimeAccountConfig,
  RuntimeControlConfig,
} from "../runtime/types";
import type { Position } from "../trading/types";
import type { VolatilityPoint } from "../types/market";
import runtimeMcpIdentity from "./identity";

interface RuntimeEngineStateReadInput {
  includePnlHistory?: boolean;
  symbol?: string;
  vPointsLimit?: number;
}

const PNL_HISTORY_LIMIT = 500;
const VPOINTS_DEFAULT_LIMIT = 200;
const VPOINTS_MAX_LIMIT = 1000;

function iso(timestamp?: number): string | null {
  return timestamp && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Accepts LINK, LINK_USDT, or LINKUSDT and returns the base map key. */
function normalizeSymbolInput(value: unknown): string | undefined {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return undefined;
  const base = raw.replace(/_?USDT$/, "");
  return base || undefined;
}

/** Serializes one account without exchange credentials. */
function serializeAccount(account: RuntimeAccountConfig) {
  const { credentials: _credentials, ...rest } = account;
  return {
    ...cloneJson(rest),
    credentialStatus: {
      configured: Boolean(
        _credentials?.apiKey && _credentials?.apiSecret,
      ),
    },
  };
}

/** Serializes runtime controls with MCP token secrets stripped. */
function serializeRuntimeConfig(runtime?: RuntimeControlConfig) {
  if (!runtime) return undefined;
  const { mcp, ...rest } = runtime;
  return {
    ...cloneJson(rest),
    mcp: {
      tokens: (mcp?.tokens ?? []).map((token) => ({
        createdAt: token.createdAt,
        enabled: token.enabled,
        id: token.id,
        lastUsedAt: token.lastUsedAt,
        name: token.name,
        permissions: token.permissions,
        secretAvailable: Boolean(token.tokenSecretEncrypted),
      })),
    },
  };
}

/** Serializes one position, keeping the vPoint refs that trace consumption. */
function serializePosition(position: Position, includePnlHistory: boolean) {
  const { history, ...pnlRest } = position.pnl ?? {};
  const averaging = position.strategy?.averaging;
  const closed = position.closed;
  return {
    account: position.account,
    averaging: averaging
      ? {
          entryLevel: averaging.entryLevel,
          executions: (averaging.executions ?? []).map((execution) => ({
            ...cloneJson(execution),
            tIso: iso(execution.t),
          })),
          lastHandledLevel: averaging.lastHandledLevel,
          reserveBaseMarginUsdt: averaging.reserveBaseMarginUsdt,
          reservedRemainingMarginUsdt:
            averaging.reservedRemainingMarginUsdt,
          steps: cloneJson(averaging.steps ?? []),
        }
      : undefined,
    closed: closed
      ? {
          feeUsdt: closed.feeUsdt,
          message: closed.message,
          price: closed.price,
          reason: closed.reason,
          source: closed.source,
          t: iso(closed.t),
          tMs: closed.t,
          vPoint: closed.vPoint,
        }
      : undefined,
    control: cloneJson(position.control ?? null),
    direction: position.direction,
    executionMode: position.executionMode,
    exposure: cloneJson(position.exposure),
    fees: cloneJson(position.fees),
    funding: cloneJson(position.funding ?? null),
    lastMonitoringStage: cloneJson(position.lastMonitoringStage ?? null),
    notes: position.notes,
    opened: {
      message: position.opened.message,
      price: position.opened.price,
      reason: position.opened.reason,
      source: position.opened.source,
      t: iso(position.opened.t),
      tMs: position.opened.t,
      vPoint: position.opened.vPoint,
    },
    pnl: {
      ...cloneJson(pnlRest),
      historyPoints: history?.length ?? 0,
      ...(includePnlHistory && history
        ? { history: history.slice(-PNL_HISTORY_LIMIT) }
        : {}),
    },
    symbol: position.symbol,
    tradingMode: position.tradingMode,
    vPoints: cloneJson(position.vPoints ?? []),
  };
}

/**
 * Summarizes one symbol's volatility points: the latest point plus which
 * marker consumed which point id (`usedBy` marker strings, conventionally
 * `"<slug>"` or `"<slug>:<ROLE>"`). When `limit` is provided the recent
 * point array is included in full.
 */
function summarizeSymbolPoints(
  points: VolatilityPoint[] | undefined,
  limit?: number,
) {
  const list = points ?? [];
  const usedBy: Record<string, string[]> = {};
  const used: string[] = [];
  for (const point of list) {
    const id = String(point.id ?? "");
    if (!id) continue;
    if (point.used === true) used.push(id);
    for (const marker of point.usedBy ?? []) {
      const slug = String(marker || "").trim();
      if (!slug) continue;
      (usedBy[slug] ??= []).push(id);
    }
  }
  return {
    count: list.length,
    latest: list.length ? cloneJson(list.at(-1)) : null,
    used,
    usedBy,
    ...(limit !== undefined
      ? { points: list.slice(-limit).map(cloneJson) }
      : {}),
  };
}

/** Serializes the engine state into a bounded, credential-free snapshot. */
function serialize(context: RuntimeContext, input: RuntimeEngineStateReadInput) {
  const state = context.state;
  const nowMs = Date.now();
  const symbolFilter = normalizeSymbolInput(input.symbol);
  const vPointsLimit = Math.min(
    VPOINTS_MAX_LIMIT,
    Math.max(
      1,
      Math.floor(Number(input.vPointsLimit)) || VPOINTS_DEFAULT_LIMIT,
    ),
  );

  return {
    balance: cloneJson(state.balance ?? {}),
    config: {
      accounts: (state.config?.accounts ?? []).map(serializeAccount),
      management: cloneJson(state.config?.management ?? null),
      runtime: serializeRuntimeConfig(state.config?.runtime),
    },
    currentTime: iso(state.currentTime),
    currentTimeMs: state.currentTime,
    markPrices: Object.fromEntries(
      Object.entries(state.markPriceMap ?? {}).map(([symbol, mark]) => [
        symbol,
        {
          ageMs: Math.max(0, nowMs - (Number(mark?.lastUpdated) || 0)),
          lastUpdated: iso(mark?.lastUpdated),
          price: mark?.price,
        },
      ]),
    ),
    mode: state.mode,
    openPositions: (state.openPositions ?? []).map((position) =>
      serializePosition(position, input.includePnlHistory === true),
    ),
    volatilityPoints: Object.fromEntries(
      Object.entries(state.vPointsMap ?? {}).map(([symbol, points]) => [
        symbol,
        summarizeSymbolPoints(
          points,
          symbolFilter && symbol === symbolFilter ? vPointsLimit : undefined,
        ),
      ]),
    ),
    volume24h: cloneJson(state.volume24hMap ?? {}),
  };
}

/**
 * Reads the Precision engine state serialized against the scheduled stages.
 * The live engine serves its in-memory objects; when it is stopped the same
 * shape is hydrated from persisted state and `stateSource` reports which.
 */
// PROD:MCP_ENGINE_STATE
async function read(input: RuntimeEngineStateReadInput) {
  const runtime = production.runtime.get();
  // Status and state presence are captured before runManual so the flags
  // describe the engine at request time, not this read task itself.
  const status = runtime.status();
  const hadState = Boolean(runtime.getState());
  const snapshot = await runtime.runManual(async (context) =>
    serialize(context, input),
  );

  return {
    appName: runtimeMcpIdentity.getAppName(),
    balance: snapshot.balance,
    config: snapshot.config,
    engine: {
      currentTime: snapshot.currentTime,
      currentTimeMs: snapshot.currentTimeMs,
      mode: snapshot.mode,
      processing: status.processing,
      ready: status.ready,
      restartPending: status.restartPending,
      running: status.running,
      stateSource: hadState
        ? status.running
          ? ("live" as const)
          : ("retained" as const)
        : ("hydrated" as const),
    },
    generatedAt: new Date().toISOString(),
    markPrices: snapshot.markPrices,
    openPositions: snapshot.openPositions,
    schemaVersion: "1.0" as const,
    volatilityPoints: snapshot.volatilityPoints,
    volume24h: snapshot.volume24h,
  };
}

const runtimeMcpEngineState = { read } as const;

export default runtimeMcpEngineState;
