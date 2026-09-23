
import { runtimeAccountConfig } from "@/lib/system/runtime";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

const BOOLEAN_KEYS = [
  "averagingRescueProjectionGuardEnabled",
  "enableWatchLogic",
  "entrySpareBufferEnabled",
  "exitSidewaysToFreeWorkersForStrongCandidates",
  "lateEntryVPointPriceDriftEnabled",
  "useStopLossPlus",
] as const satisfies ReadonlyArray<keyof RuntimeAccountTradingConfig>;

const NUMBER_KEYS = [
  "exactLeverage",
  "balanceUSDT",
  "confidenceBase",
  "dcaDipPercent",
  "dcaMultiplier",
  "exitOnVPointAbsLevel",
  "maxEntryBased24HourVolPct",
  "maxEntryMargin",
  "maxEntryMarginPct",
  "maxBuyUSDT",
  "maxDcaRounds",
  "maxHoldMinutes",
  "maxLeverage",
  "maxOpenPositions",
  "maxRiskPercent",
  "minActionableAbsoluteLevel",
  "stopLossPercent",
  "stopLossPlusTrigger",
  "stopLossUSDT",
  "takeProfitPercent",
  "volatilityTargetStopLossPercent",
  "watchMaxNextAveragingLevels",
  "watchReserveLevels",
  "watchReservePctAlloc",
] as const satisfies ReadonlyArray<keyof RuntimeAccountTradingConfig>;

const ALLOWED_KEYS = new Set<keyof RuntimeAccountTradingConfig>([
  ...runtimeAccountConfig.trading.keys.dynamic,
  ...runtimeAccountConfig.trading.keys.strategy,
  "notes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${field}" must be a finite number.`);
  }
}

/** Serializes one account's non-sensitive Trading-tab configuration. */
function stringify(config: RuntimeAccountTradingConfig): string {
  return JSON.stringify(config, null, 2);
}

/** Parses the complete Trading-tab configuration copied from another account. */
function parse(raw: string): RuntimeAccountTradingConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The Trading configuration is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("The Trading configuration must be a JSON object.");
  }

  const unknownKey = Object.keys(parsed).find(
    (key) => !ALLOWED_KEYS.has(key as keyof RuntimeAccountTradingConfig),
  );
  if (unknownKey) {
    throw new Error(`Unknown Trading configuration field: "${unknownKey}".`);
  }

  if (typeof parsed.notes !== "string") {
    throw new Error('"notes" must be a string.');
  }
  for (const key of BOOLEAN_KEYS) {
    const value = parsed[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`"${key}" must be true or false.`);
    }
  }

  for (const key of NUMBER_KEYS) {
    const value = parsed[key];
    if (value !== undefined) {
      requireFiniteNumber(value, key);
    }
  }

  requireFiniteNumber(parsed.takeProfitPercent, "takeProfitPercent");

  if (
    parsed.orderType !== undefined &&
    parsed.orderType !== "maker" &&
    parsed.orderType !== "taker"
  ) {
    throw new Error('"orderType" must be "maker" or "taker".');
  }
  if (
    parsed.onlyTPFromDate !== undefined &&
    typeof parsed.onlyTPFromDate !== "string"
  ) {
    throw new Error('"onlyTPFromDate" must be a string.');
  }

  for (const key of [
    "levelBasedPctDriftStopLoss",
    "postAverageRescueExit",
    "postAverageStopLoss",
  ] as const) {
    if (parsed[key] !== undefined && !isRecord(parsed[key])) {
      throw new Error(`"${key}" must be a JSON object.`);
    }
  }

  if (parsed.adaptiveAveraging !== undefined) {
    if (!isRecord(parsed.adaptiveAveraging)) {
      throw new Error('"adaptiveAveraging" must be a JSON object.');
    }
    if (typeof parsed.adaptiveAveraging.enabled !== "boolean") {
      throw new Error('"adaptiveAveraging.enabled" must be true or false.');
    }
    requireFiniteNumber(
      parsed.adaptiveAveraging.maxMultiplier,
      "adaptiveAveraging.maxMultiplier",
    );
    requireFiniteNumber(
      parsed.adaptiveAveraging.minProjectedProfitPct,
      "adaptiveAveraging.minProjectedProfitPct",
    );
  }

  return structuredClone(parsed) as unknown as RuntimeAccountTradingConfig;
}

const tradingConfigJson = {
  parse,
  stringify,
} as const;

export default tradingConfigJson;
