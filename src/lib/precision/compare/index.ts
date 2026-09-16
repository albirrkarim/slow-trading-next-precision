import fs from "fs-extra";
import path from "path";
import type {
  PrecisionBacktestResultV1,
  PrecisionPositionV1,
  PrecisionRunV1,
  ProdTestCaseV1,
} from "../types";

/** Marker distinguishing an absent JSON path from a stored null. */
const MISSING = Symbol("precision-missing-path");

/** Canonical identity shared by production and backtest positions. */
export interface PrecisionPositionSummary {
  key: string;
  account: string;
  symbol: string;
  direction: PrecisionPositionV1["direction"];
  entryVPointId: string;
  role: string;
  openedAt: number;
  closedAt?: number;
}

/** One unequal leaf field between a paired production and backtest position. */
export interface PrecisionLeafDifference {
  path: string;
  kind: "missing" | "null" | "value";
  production: unknown;
  backtest: unknown;
  productionMissing: boolean;
  backtestMissing: boolean;
  absGap?: number;
  pctGap?: number;
}

/** Score and differences for one candidate position pair. */
export interface PrecisionPairResult extends PrecisionPositionSummary {
  equalLeaves: number;
  totalLeaves: number;
  precisionPct: number;
  differences: PrecisionLeafDifference[];
}

/** Complete result of one production-versus-backtest comparison. */
export interface PrecisionComparisonResult {
  valid: boolean;
  mismatches: string[];
  pairCount: number;
  totalEqualLeaves: number;
  totalLeaves: number;
  overallPrecisionPct: number | null;
  pairs: PrecisionPairResult[];
  ambiguousKeys: Array<{
    key: string;
    productionCount: number;
    backtestCount: number;
  }>;
  productionOnly: PrecisionPositionSummary[];
  backtestOnly: PrecisionPositionSummary[];
}

/** Builds the canonical pairing key for one position. */
export function buildPrecisionPositionKey(
  position: PrecisionPositionV1,
): string {
  return [
    position.account,
    String(position.symbol || "").trim().toUpperCase(),
    position.direction,
    position.opened?.vPoint?.id ?? "",
    position.role ?? "MAIN",
  ].join("|");
}

/** Serializes a JSON value with sorted keys for equality checks. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

/** Returns whether two JSON values are structurally equal. */
function stableEquals(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/** Collects the union of leaf paths in one position. */
function collectLeafPaths(
  value: unknown,
  prefix: string,
  paths: Set<string>,
): void {
  if (value === null || typeof value !== "object") {
    paths.add(prefix);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLeafPaths(item, `${prefix}/${index}`, paths);
    });
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    collectLeafPaths(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}/${key}` : key,
      paths,
    );
  }
}

/** Reads one position's value at a collected leaf path. */
function readLeafPath(
  container: unknown,
  leafPath: string,
): typeof MISSING | unknown {
  let current = container;
  const segments = leafPath.split("/");

  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return MISSING;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return MISSING;
      }
      current = current[index];
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return MISSING;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Formats a collected leaf path for display. */
function formatLeafPath(leafPath: string): string {
  return leafPath
    .split("/")
    .map((segment, index) =>
      index === 0
        ? segment
        : /^\d+$/.test(segment)
          ? `[${segment}]`
          : `.${segment}`,
    )
    .join("");
}

/** Builds a dashboard-safe summary for one position. */
function summarizePosition(
  position: PrecisionPositionV1,
): PrecisionPositionSummary {
  return {
    key: buildPrecisionPositionKey(position),
    account: position.account,
    symbol: position.symbol,
    direction: position.direction,
    entryVPointId: position.opened?.vPoint?.id ?? "",
    role: position.role ?? "MAIN",
    openedAt: position.opened?.t ?? 0,
    closedAt: position.closed?.t,
  };
}

/** Compares one candidate pair leaf by leaf, excluding executionMode. */
function comparePair(params: {
  production: PrecisionPositionV1;
  backtest: PrecisionPositionV1;
}): PrecisionPairResult {
  // TC: BOTH:PRODUCTION_BACKTEST_POSITION_COMPARISON
  const paths = new Set<string>();
  collectLeafPaths(params.production, "", paths);
  collectLeafPaths(params.backtest, "", paths);

  let equalLeaves = 0;
  let totalLeaves = 0;
  const differences: PrecisionLeafDifference[] = [];

  for (const leafPath of paths) {
    if (leafPath === "executionMode") {
      continue;
    }

    totalLeaves += 1;
    const production = readLeafPath(params.production, leafPath);
    const backtest = readLeafPath(params.backtest, leafPath);
    const productionMissing = production === MISSING;
    const backtestMissing = backtest === MISSING;

    if (!productionMissing && !backtestMissing && production === backtest) {
      equalLeaves += 1;
      continue;
    }

    const kind: PrecisionLeafDifference["kind"] =
      productionMissing || backtestMissing
        ? "missing"
        : production === null || backtest === null
          ? "null"
          : "value";
    const difference: PrecisionLeafDifference = {
      path: formatLeafPath(leafPath),
      kind,
      production: productionMissing ? null : production,
      backtest: backtestMissing ? null : backtest,
      productionMissing,
      backtestMissing,
    };

    if (
      typeof production === "number" &&
      typeof backtest === "number" &&
      production !== backtest
    ) {
      difference.absGap = Math.abs(production - backtest);
      difference.pctGap =
        production === 0
          ? undefined
          : (difference.absGap / Math.abs(production)) * 100;
    }

    differences.push(difference);
  }

  return {
    ...summarizePosition(params.production),
    equalLeaves,
    totalLeaves,
    precisionPct: totalLeaves === 0 ? 100 : (equalLeaves / totalLeaves) * 100,
    differences,
  };
}

/** Validates the run shape required for comparison and returns it typed. */
export function validatePrecisionRun(value: unknown): PrecisionRunV1 {
  const run = value as PrecisionRunV1;
  if (
    !run ||
    run.schema !== 1 ||
    !["multi", "hedge", "streak"].includes(run.strategy) ||
    !["live", "sandbox", "backtest"].includes(run.mode) ||
    typeof run.startTime !== "number" ||
    !Number.isFinite(run.startTime) ||
    typeof run.endTime !== "number" ||
    !Number.isFinite(run.endTime) ||
    !run.config ||
    typeof run.config !== "object" ||
    !run.initialState ||
    typeof run.initialState !== "object" ||
    !Array.isArray(run.endPositions)
  ) {
    throw new Error("Invalid precision run file");
  }

  return run;
}

/** Validates equal period, strategy, configuration, and starting state. */
function validateCompatibility(params: {
  production: ProdTestCaseV1;
  backtest: PrecisionBacktestResultV1;
}): string[] {
  const mismatches: string[] = [];
  const { production, backtest } = params;

  if (production.strategy !== backtest.strategy) {
    mismatches.push("strategy");
  }
  if (production.startTime !== backtest.startTime) {
    mismatches.push("startTime");
  }
  if (production.endTime !== backtest.endTime) {
    mismatches.push("endTime");
  }
  if (!stableEquals(production.config, backtest.config)) {
    mismatches.push("config");
  }
  if (!stableEquals(production.initialState, backtest.initialState)) {
    mismatches.push("initialState");
  }

  return mismatches;
}

/** Groups positions by canonical key while preserving duplicate counts. */
function groupByKey(
  positions: PrecisionPositionV1[],
): Map<string, PrecisionPositionV1[]> {
  const groups = new Map<string, PrecisionPositionV1[]>();
  for (const position of positions) {
    const key = buildPrecisionPositionKey(position);
    const group = groups.get(key) ?? [];
    group.push(position);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Compares one production test case against one backtest result.
 *
 * Refuses scoring unless period, strategy, configuration, and initial state
 * match, then pairs positions by canonical key and scores equal leaves.
 */
export function comparePrecisionRuns(params: {
  production: ProdTestCaseV1;
  backtest: PrecisionBacktestResultV1;
}): PrecisionComparisonResult {
  // TC: BOTH:PRECISION_MEASUREMENT
  const mismatches = validateCompatibility(params);
  if (mismatches.length > 0) {
    return {
      valid: false,
      mismatches,
      pairCount: 0,
      totalEqualLeaves: 0,
      totalLeaves: 0,
      overallPrecisionPct: null,
      pairs: [],
      ambiguousKeys: [],
      productionOnly: [],
      backtestOnly: [],
    };
  }

  const productionGroups = groupByKey(params.production.endPositions);
  const backtestGroups = groupByKey(params.backtest.endPositions);
  const ambiguousKeys: PrecisionComparisonResult["ambiguousKeys"] = [];
  const productionOnly: PrecisionPositionSummary[] = [];
  const backtestOnly: PrecisionPositionSummary[] = [];
  const pairs: PrecisionPairResult[] = [];

  for (const [key, productionPositions] of productionGroups) {
    const backtestPositions = backtestGroups.get(key) ?? [];
    if (productionPositions.length > 1 || backtestPositions.length > 1) {
      ambiguousKeys.push({
        key,
        productionCount: productionPositions.length,
        backtestCount: backtestPositions.length,
      });
      continue;
    }

    if (backtestPositions.length === 0) {
      productionOnly.push(summarizePosition(productionPositions[0]));
      continue;
    }

    pairs.push(
      comparePair({
        production: productionPositions[0],
        backtest: backtestPositions[0],
      }),
    );
  }

  for (const [key, backtestPositions] of backtestGroups) {
    if (productionGroups.has(key)) {
      continue;
    }
    if (backtestPositions.length > 1) {
      ambiguousKeys.push({
        key,
        productionCount: 0,
        backtestCount: backtestPositions.length,
      });
      continue;
    }

    backtestOnly.push(summarizePosition(backtestPositions[0]));
  }

  const totalEqualLeaves = pairs.reduce(
    (sum, pair) => sum + pair.equalLeaves,
    0,
  );
  const totalLeaves = pairs.reduce((sum, pair) => sum + pair.totalLeaves, 0);

  return {
    valid: true,
    mismatches: [],
    pairCount: pairs.length,
    totalEqualLeaves,
    totalLeaves,
    overallPrecisionPct:
      totalLeaves === 0 ? null : (totalEqualLeaves / totalLeaves) * 100,
    pairs: pairs.sort((left, right) => left.key.localeCompare(right.key)),
    ambiguousKeys,
    productionOnly,
    backtestOnly,
  };
}

/** Resolves one run file inside its allowed root without traversal. */
export function resolvePrecisionRunPath(
  root: string,
  fileName: string,
): string {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, fileName);
  if (
    !fileName.endsWith(".json") ||
    resolved === normalizedRoot ||
    !resolved.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid precision run file name");
  }

  return resolved;
}

/** Reads and validates one precision run file from disk. */
export async function readPrecisionRunFile(
  filePath: string,
): Promise<PrecisionRunV1> {
  const raw = (await fs.readJSON(filePath)) as unknown;
  return validatePrecisionRun(raw);
}

const precisionCompare = {
  key: {
    build: buildPrecisionPositionKey,
  },
  path: {
    resolve: resolvePrecisionRunPath,
  },
  run: {
    compare: comparePrecisionRuns,
    read: readPrecisionRunFile,
    validate: validatePrecisionRun,
  },
} as const;

export default precisionCompare;
export { precisionCompare };
