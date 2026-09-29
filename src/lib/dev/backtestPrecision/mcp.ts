import { runtimeMcp } from "@/lib/system/mcp";
import { runtimeStorage } from "@/lib/system/storage";
import sanitize from "@/lib/system/storage/sanitize";
import systemTime from "@/lib/system/time";
import type { Position } from "@/lib/system/trading";
import type { Kline } from "@/lib/exchange/types";
import pair from "@/lib/strategies/shared/pair";
import { buildTradeMarkersFromHistory } from "@/lib/system/utils/ui/trade-markers";
import { DAY_MS, getDayStart } from "../klines";
import backtestLeaderboards from "./leaderboards";
import backtestResultCache from "./api/cache";
import backtestRunner from "./api/runner";
import type { BacktestPrecisionParams } from "./api/precision-api-types";
import {
  createDatasetReader,
  datasetCoverage,
  datasetSymbolFileBounds,
} from "./backtest/data";

const KEY_PATTERN = /^[0-9a-f]{64}$/;
/** Staging dirs untouched this long report "interrupted", not "running". */
const STALE_STAGING_MS = 30 * 60_000;
const INSPECT_MAX_PAD_DAYS = 30;

function requireKey(args: Record<string, unknown>): string {
  const key = String(args.cacheKey ?? "").trim();
  if (!KEY_PATTERN.test(key)) {
    throw new Error('"cacheKey" must be a 64-char cache key hash.');
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves a dotted field path (e.g. "pnl.netUsdt") on a row object. */
function getPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

/**
 * The dashboard catalog as a clone-able backtest config — credentials masked
 * (backtests only need public klines) — plus per-symbol dataset coverage so
 * agents see each symbol's usable history before choosing a range.
 */
async function configTemplate() {
  const catalog = await runtimeStorage.catalog.ensure();
  return {
    config: sanitize.maskSecrets(catalog.config),
    coverage: await datasetCoverage(),
    note:
      "A run covers only the intersection of all configured symbols' coverage — a later-listed symbol clips the effective range (see run status dataset).",
  };
}

async function run(args: Record<string, unknown>) {
  const params = args as unknown as BacktestPrecisionParams;
  const { config } = params;
  if (!isRecord(config) || !Array.isArray(config.accounts)) {
    throw new Error('"config" must be a BacktestTestCase config object.');
  }
  if (!config.accounts.some((account) => account?.enabled)) {
    throw new Error("Enable at least one SLOW account before backtesting.");
  }

  let { range, startTime, endTime } = params;
  if (startTime && endTime && range === "custom") {
    range = `${systemTime.formatReadable(startTime)}_to_${systemTime.formatReadable(endTime)}`;
    startTime = undefined;
    endTime = undefined;
  }

  const upToDateKlines = params.upToDateKlines === true;
  const upToDateDecisionBacktest = params.upToDateDecisionBacktest === true;
  const effective: BacktestPrecisionParams = {
    ...params,
    endTime,
    range,
    startTime,
    upToDateDecisionBacktest,
    upToDateKlines,
    verbose: false,
  };

  const cacheKey = backtestResultCache.key({
    config,
    endTime,
    range,
    startTime,
  });
  const cachePath = backtestResultCache.dirFor(cacheKey);

  if (!upToDateKlines && !upToDateDecisionBacktest) {
    const cached = await backtestResultCache.readMeta(cacheKey);
    if (cached) {
      return { cacheKey, cachePath, cached: true, status: "done", ...cached };
    }
  }

  // One heavy run at a time — a second agent is told to wait and poll rather
  // than racing a parallel simulation. Identical params skip this and join
  // the in-flight run via start()'s alreadyRunning dedupe.
  const running = backtestRunner.activeRun();
  if (running && running.cacheKey !== cacheKey) {
    return {
      cacheKey,
      cachePath,
      note: "Another backtest is in flight — poll backtest_run_status on that cacheKey and retry once it finishes.",
      running,
      status: "busy",
    };
  }

  const handle = backtestRunner.start(effective);
  // The failure lands in .failed/<key>.json — the tool already returned, so
  // the rejection must not propagate as an unhandled rejection.
  void handle.result.catch(() => {});
  return {
    alreadyRunning: handle.alreadyRunning,
    cacheKey: handle.cacheKey,
    cachePath: handle.cachePath,
    status: "running",
  };
}

// BTEST:MCP_RUN_STATUS — done / failed / running / interrupted detection
// from meta.json, .failed markers, and live staging dirs.
async function runStatus(args: Record<string, unknown>) {
  const cacheKey = requireKey(args);

  const meta = await backtestResultCache.readMeta(cacheKey);
  if (meta) {
    return { cacheKey, status: "done", ...meta };
  }

  const failed = await backtestResultCache.readFailed(cacheKey);
  if (failed) {
    return {
      cacheKey,
      error: failed.error,
      failedAt: failed.t,
      status: "failed",
    };
  }

  const staging = await backtestResultCache.stagingInfo(cacheKey);
  if (staging) {
    const stale = Date.now() - staging.modifiedAt > STALE_STAGING_MS;
    return {
      cacheKey,
      lastActivity: staging.modifiedAt,
      status: stale ? "interrupted" : "running",
    };
  }

  return {
    cacheKey,
    status: "unknown",
    note: "No finished cache entry, failure record, or staging dir for this key.",
  };
}

async function resultRead(args: Record<string, unknown>) {
  const cacheKey = requireKey(args);
  const field = String(args.field ?? "");
  if (field !== "positions" && field !== "vpoints" && field !== "snapshots") {
    throw new Error('"field" must be positions|vpoints|snapshots.');
  }
  const name = typeof args.name === "string" ? args.name : undefined;
  const data = await backtestResultCache.readField(cacheKey, field, name);
  if (data === null || data === undefined) {
    return { error: "Artifact not found for this cache key." };
  }

  if (!Array.isArray(data)) return data;

  const sort = typeof args.sort === "string" ? args.sort : undefined;
  let rows = data;
  if (sort) {
    const order = args.order === "desc" ? -1 : 1;
    rows = [...data].sort((a, b) => {
      const av = getPath(a, sort);
      const bv = getPath(b, sort);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * order;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * order;
    });
  }

  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Math.min(1000, Math.max(1, Number(args.limit) || 100));
  return {
    items: rows.slice(offset, offset + limit),
    limit,
    offset,
    total: rows.length,
  };
}

async function runsList(args: Record<string, unknown>) {
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
  const metas = await backtestResultCache.listMetas();
  return {
    runs: metas.slice(0, limit).map((meta) => {
      const config = isRecord(meta.params?.config) ? meta.params.config : {};
      const management = isRecord(config.management) ? config.management : {};
      return {
        cacheKey: meta.cacheKey,
        counts: meta.counts,
        createdAt: meta.createdAt,
        dataset: meta.dataset,
        exchangeType: meta.exchangeType,
        range: meta.params?.range,
        strategy: management.strategy,
        summary: meta.summary,
        symbols: management.symbols,
      };
    }),
    total: metas.length,
  };
}

function findTrade(positions: Position[], tradeId: string): Position | null {
  return (
    positions.find(
      (position) =>
        position.opened?.vPoint?.id === tradeId ||
        `${position.account}:${position.opened.t}` === tradeId ||
        String(position.opened.t) === tradeId,
    ) ?? null
  );
}

async function tradeInspect(args: Record<string, unknown>) {
  const cacheKey = requireKey(args);
  const tradeId = String(args.tradeId ?? "").trim();
  if (!tradeId) throw new Error('"tradeId" is required.');

  const positions = (await backtestResultCache.readField(
    cacheKey,
    "positions",
  )) as Position[] | null;
  if (!positions) return { error: "Positions artifact not found." };

  const trade = findTrade(positions, tradeId);
  if (!trade) {
    return {
      error:
        "Trade not found — tradeId is the entry vPoint id (opened.vPoint.id), account:openedT, or opened timestamp.",
    };
  }

  const padDays = Math.min(
    INSPECT_MAX_PAD_DAYS,
    Math.max(0, Number(args.padDays ?? 7) || 0),
  );
  const endBound = trade.closed?.t ?? trade.opened.t;
  let windowStart = trade.opened.t - padDays * DAY_MS;
  let windowEnd = endBound + padDays * DAY_MS;

  // Clamp to existing day files so the reader never hits a missing file.
  let klines: Kline[] = [];
  let klinesNote: string | undefined;
  const bounds = await datasetSymbolFileBounds(trade.symbol);
  if (bounds) {
    const minStart = getDayStart(
      Date.parse(`${bounds.firstDay}T00:00:00Z`),
    );
    const maxEnd = getDayStart(Date.parse(`${bounds.lastDay}T00:00:00Z`)) + DAY_MS;
    windowStart = Math.max(windowStart, minStart);
    windowEnd = Math.min(windowEnd, maxEnd);
    if (windowStart < windowEnd) {
      const reader = createDatasetReader([trade.symbol]);
      klines = await reader.getKlines({
        endTime: windowEnd,
        interval: "1m",
        startTime: windowStart,
        symbol: trade.symbol,
      });
    } else {
      klinesNote = "Requested window lies outside the symbol's dataset days.";
    }
  } else {
    klinesNote = `No dataset files for ${trade.symbol}.`;
  }

  const legMeta = pair.meta.ofPosition(trade);
  const sibling = legMeta
    ? positions.find(
        (position) =>
          position !== trade &&
          pair.meta.ofPosition(position)?.pairId === legMeta.pairId,
      )
    : undefined;

  const overlapping = positions.filter((position) => {
    if (position.symbol !== trade.symbol) return false;
    const openT = position.opened.t;
    const closeT = position.closed?.t ?? Number.POSITIVE_INFINITY;
    return openT <= windowEnd && closeT >= windowStart;
  });
  const markers = buildTradeMarkersFromHistory(
    overlapping,
    trade.symbol,
    (row) => pair.meta.ofPosition(row as Position)?.role,
  );

  const vPoints = (
    ((await backtestResultCache.readField(
      cacheKey,
      "vpoints",
      trade.symbol,
    )) as { t: number }[] | null) ?? []
  ).filter((point) => point.t >= windowStart && point.t <= windowEnd);

  return {
    klines: { interval: "1m", items: klines, note: klinesNote },
    markers,
    pairId: legMeta?.pairId,
    sibling,
    trade,
    vPoints,
    window: { endTime: windowEnd, padDays, startTime: windowStart },
  };
}

async function resultMetrics(args: Record<string, unknown>) {
  const cacheKey = requireKey(args);
  const result = await backtestResultCache.read(cacheKey);
  if (!result) {
    return { error: "Backtest result is not cached; run it first." };
  }
  return backtestLeaderboards.metrics.compute(result);
}

async function leaderboardSave(args: Record<string, unknown>) {
  const cacheKey = requireKey(args);
  const result = await backtestResultCache.read(cacheKey);
  if (!result) {
    return { error: "Backtest result is not cached; run it first." };
  }
  const params = await backtestResultCache.readParams(cacheKey);
  const config = isRecord(params?.config) ? params.config : undefined;
  const label = typeof args.label === "string" ? args.label : undefined;
  const entry = await backtestLeaderboards.store.save({
    // The page's BacktestConfig shape: range + settings (runtime config).
    backtestConfig: {
      name: label,
      range: params?.range,
      settings: config,
      startTime: params?.startTime,
      endTime: params?.endTime,
    },
    cacheKey,
    label,
    leaderboard: backtestLeaderboards.metrics.compute(result),
  });
  return { entry };
}

async function leaderboardList() {
  return { entries: await backtestLeaderboards.store.list() };
}

async function leaderboardDelete(args: Record<string, unknown>) {
  const id = String(args.id ?? "");
  if (!/^[0-9a-f]{12}$/.test(id)) {
    throw new Error('"id" must be a 12-char leaderboard entry hash.');
  }
  if (!(await backtestLeaderboards.store.remove(id))) {
    return { error: "Leaderboard entry not found." };
  }
  return { ok: true };
}

/** Registers every backtest tool handler — gating happens in tools.call. */
function register() {
  const tools = runtimeMcp.tools;
  tools.registerHandler("backtest_config_template", () => configTemplate());
  tools.registerHandler("backtest_precision_run", ({ args }) => run(args));
  tools.registerHandler("backtest_run_status", ({ args }) => runStatus(args));
  tools.registerHandler("backtest_result_read", ({ args }) => resultRead(args));
  tools.registerHandler("backtest_runs_list", ({ args }) => runsList(args));
  tools.registerHandler("backtest_trade_inspect", ({ args }) =>
    tradeInspect(args),
  );
  tools.registerHandler("backtest_result_metrics", ({ args }) =>
    resultMetrics(args),
  );
  tools.registerHandler("backtest_leaderboard_save", ({ args }) =>
    leaderboardSave(args),
  );
  tools.registerHandler("backtest_leaderboard_list", () => leaderboardList());
  tools.registerHandler("backtest_leaderboard_delete", ({ args }) =>
    leaderboardDelete(args),
  );
}

const backtestMcp = { register } as const;

export default backtestMcp;
