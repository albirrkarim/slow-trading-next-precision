import fs from "fs-extra";
import path from "path";

import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import featureGateDataset from "@/lib/dev/backtestPrecision/feature-gate-dataset";

import datasetFilters from "./filters";
import type {
  FeatureGateDatasetOption,
  FeatureGateDatasetRow,
  FeatureGateRowPage,
  FeatureGateRowQuery,
} from "./types";

export const HASH_PATTERN = /^[0-9a-f]{64}$/;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/**
 * Reads one run's dataset directory into a symbol-grouped row map.
 * Throws a clear error when the run predates dataset capture.
 */
async function readRows(
  hash: string,
): Promise<Record<string, FeatureGateDatasetRow[]>> {
  if (!HASH_PATTERN.test(hash)) {
    throw new Error('"hash" must be a 64-char cache key hash.');
  }
  const dir = featureGateDataset.datasetDir(backtestResultCache.dirFor(hash));
  if (!(await fs.pathExists(dir))) {
    throw new Error(
      `Run ${hash} has no dataset — re-run it with "also produce dataset" enabled.`,
    );
  }
  const bySymbol: Record<string, FeatureGateDatasetRow[]> = {};
  const names = (await fs.readdir(dir)).filter((name) =>
    name.endsWith(".json"),
  );
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    bySymbol[path.basename(name, ".json")] = (await fs.readJson(
      file,
    )) as FeatureGateDatasetRow[];
  }
  return bySymbol;
}

/** Row ordering key — capture time, falling back to the signal's own time. */
function rowTime(row: FeatureGateDatasetRow): number {
  return row.t ?? row.sequences[0]?.t ?? 0;
}

/**
 * Paginated, filtered dataset view for the UI table. Filters apply before
 * pagination so `total` is the filtered count; `symbols` always lists every
 * symbol that produced rows regardless of the active filter.
 */
async function queryRows(
  query: FeatureGateRowQuery,
): Promise<FeatureGateRowPage> {
  const bySymbol = await readRows(query.hash);
  const symbols = Object.keys(bySymbol).sort();
  const datasetTotal = symbols.reduce(
    (sum, symbol) => sum + bySymbol[symbol].length,
    0,
  );
  const source = query.symbol
    ? (bySymbol[query.symbol] ?? [])
    : symbols.flatMap((symbol) => bySymbol[symbol]);

  const order = query.order === "desc" ? -1 : 1;
  const sortKeys: Record<
    NonNullable<FeatureGateRowQuery["sort"]>,
    (row: FeatureGateDatasetRow) => number
  > = {
    missScore: (row) =>
      // Unresolved rows sink to the bottom regardless of direction.
      row.missScore ?? (order === 1 ? Infinity : -Infinity),
    sequence: (row) => row.sequences.length,
    time: (row) => rowTime(row),
  };
  const sortKey = sortKeys[query.sort ?? "time"];

  const filtered = source
    .filter((row) => datasetFilters.matches(row, query))
    .sort((a, b) => (sortKey(a) - sortKey(b)) * order);

  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);
  const start = (page - 1) * pageSize;
  return {
    datasetTotal,
    page,
    pageSize,
    rows: filtered.slice(start, start + pageSize),
    symbols,
    total: filtered.length,
  };
}

/**
 * Lists finished backtest runs that produced a `dataset/` artifact —
 * options for the gate-evaluation hash picker, newest first.
 */
async function listRuns(): Promise<FeatureGateDatasetOption[]> {
  const options: FeatureGateDatasetOption[] = [];
  for (const entry of await backtestResultCache.listMetas()) {
    const dir = featureGateDataset.datasetDir(
      backtestResultCache.dirFor(entry.cacheKey),
    );
    if (!(await fs.pathExists(dir))) continue;
    const datasetSymbols = (await fs.readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.basename(name, ".json"))
      .sort();
    if (datasetSymbols.length === 0) continue;

    const params = entry.params ?? {};
    const config = (params.config ?? {}) as {
      management?: {
        strategy?: unknown;
        symbols?: unknown;
        tradingMode?: unknown;
      };
      symbols?: unknown;
    };
    const management = config.management ?? {};
    const rawCoins = management.symbols ?? config.symbols;
    options.push({
      coins: Array.isArray(rawCoins)
        ? rawCoins.filter((s): s is string => typeof s === "string")
        : [],
      createdAt: entry.createdAt,
      datasetSymbols,
      datasetWindow: entry.dataset,
      exchangeType: entry.exchangeType,
      hash: entry.cacheKey,
      marketType: management.tradingMode === "futures" ? "FUTURES" : "SPOT",
      range: typeof params.range === "string" ? params.range : undefined,
      strategy:
        typeof management.strategy === "string"
          ? management.strategy
          : undefined,
    });
  }
  return options;
}

const dataset = { listRuns, queryRows, readRows } as const;

export default dataset;
