import type {
  RuntimeAccountConfig,
  RuntimeAccountTradingConfig,
  RuntimeEffectiveConfig,
  RuntimeManagementConfig,
} from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Trading-tab keys owned by each account's `trading` config. */
export const ACCOUNT_TRADING_CONFIG_KEYS = [
  "adaptiveAveraging",
  "averagingRescueProjectionGuardEnabled",
  "enableWatchLogic",
  "entrySpareBufferEnabled",
  "exactLeverage",
  "exitSidewaysToFreeWorkersForStrongCandidates",
  "lateEntryVPointPriceDriftEnabled",
  "maxEntryBased24HourVolPct",
  "maxEntryMargin",
  "maxEntryMarginPct",
  "maxLeverage",
  "maxOpenPositions",
  "minActionableAbsoluteLevel",
  "watchMaxNextAveragingLevels",
  "watchReserveLevels",
  "watchReservePctAlloc",
] as const satisfies ReadonlyArray<keyof RuntimeAccountTradingConfig>;

/** Strategy keys owned by each account's `trading` config. */
export const ACCOUNT_STRATEGY_CONFIG_KEYS = [
  "balanceUSDT",
  "confidenceBase",
  "dcaDipPercent",
  "dcaMultiplier",
  "exitOnVPointAbsLevel",
  "levelBasedPctDriftStopLoss",
  "maxBuyUSDT",
  "maxDcaRounds",
  "maxHoldMinutes",
  "maxRiskPercent",
  "onlyTPFromDate",
  "orderType",
  "postAverageRescueExit",
  "postAverageStopLoss",
  "stopLossPercent",
  "stopLossPlusTrigger",
  "stopLossUSDT",
  "takeProfitPercent",
  "useStopLossPlus",
  "volatilityTargetStopLossPercent",
] as const satisfies ReadonlyArray<keyof RuntimeAccountTradingConfig>;

/** Strategy fields shared once under `management`, not per account. */
export const SHARED_STRATEGY_CONFIG_KEYS = [
  "minimalAssetOnTrade",
  "safePercentPerMonth",
  "safeUSDTPerMonth",
] as const satisfies ReadonlyArray<keyof RuntimeManagementConfig>;

/** Management-owned keys on the flat effective config. */
export const SHARED_MANAGEMENT_CONFIG_KEYS = [
  "blackSwan",
  "decisionEngineVersion",
  "description",
  "exchangeType",
  "name",
  "symbols",
  "tradingMode",
] as const satisfies ReadonlyArray<keyof RuntimeManagementConfig>;

type FlatConfig = RuntimeManagementConfig & RuntimeAccountTradingConfig;

/** Extracts exactly the settings owned by the Trading tab. */
function tradingFromEffective(
  config: Partial<FlatConfig>,
  notes = "",
): RuntimeAccountTradingConfig {
  const trading = {
    notes: typeof notes === "string" ? notes : "",
  } as RuntimeAccountTradingConfig;

  for (const key of [
    ...ACCOUNT_TRADING_CONFIG_KEYS,
    ...ACCOUNT_STRATEGY_CONFIG_KEYS,
  ]) {
    const value = config[key];
    if (value !== undefined) {
      Object.assign(trading, { [key]: clone(value) });
    }
  }

  return trading;
}

/** Overlays one account's Trading-tab settings onto the shared config. */
function tradingToEffective(
  management: RuntimeManagementConfig,
  account: Pick<RuntimeAccountConfig, "trading">,
): RuntimeEffectiveConfig {
  const trading = clone(account.trading) as unknown as Record<string, unknown>;
  const accountConfig: Record<string, unknown> = {};

  for (const key of [
    ...ACCOUNT_TRADING_CONFIG_KEYS,
    ...ACCOUNT_STRATEGY_CONFIG_KEYS,
  ]) {
    const value = trading[key];
    if (value !== undefined) {
      accountConfig[key] = clone(value);
    }
  }

  return {
    ...clone(management),
    ...(accountConfig as unknown as RuntimeAccountTradingConfig),
  };
}

/** Replaces only the per-account Trading-tab settings from an effective config. */
function tradingWithEffective(
  account: RuntimeAccountConfig,
  config: Partial<FlatConfig>,
): RuntimeAccountConfig {
  return {
    ...account,
    trading: tradingFromEffective(config, account.trading?.notes ?? ""),
    updatedAt: Date.now(),
  };
}

/** Replaces only settings owned by shared Management/Black-Swan config. */
function sharedFromEffective(
  currentManagement: RuntimeManagementConfig,
  effectiveConfig: Partial<FlatConfig>,
): RuntimeManagementConfig {
  const next = clone(currentManagement) as unknown as Record<string, unknown>;
  for (const key of [
    ...SHARED_MANAGEMENT_CONFIG_KEYS,
    ...SHARED_STRATEGY_CONFIG_KEYS,
  ]) {
    const value = effectiveConfig[key];
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = clone(value);
    }
  }
  return next as unknown as RuntimeManagementConfig;
}

/** Merges shared management settings with one account's trading overrides. */
function effective(
  management: RuntimeManagementConfig,
  account: Pick<RuntimeAccountConfig, "trading">,
): RuntimeEffectiveConfig {
  return tradingToEffective(management, account);
}

/** Grouped flat↔split config helpers shared by storage and dashboard. */
const runtimeAccountConfig = {
  effective,
  shared: {
    fromEffective: sharedFromEffective,
    keys: {
      management: SHARED_MANAGEMENT_CONFIG_KEYS,
      strategy: SHARED_STRATEGY_CONFIG_KEYS,
    },
  },
  trading: {
    fromEffective: tradingFromEffective,
    keys: {
      dynamic: ACCOUNT_TRADING_CONFIG_KEYS,
      strategy: ACCOUNT_STRATEGY_CONFIG_KEYS,
    },
    toEffective: tradingToEffective,
    withEffective: tradingWithEffective,
  },
} as const;

export default runtimeAccountConfig;
export { runtimeAccountConfig };
