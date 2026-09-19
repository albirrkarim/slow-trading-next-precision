import type { DynamicTradeConfig } from "@/lib/dynamic";
import type {
  SlowTradingAccount,
  SlowTradingAccountTradingConfig,
  SlowTradingManagementConfig,
} from "./types";
import { clone } from "./storage/common";

const DYNAMIC_CONFIG_KEYS = [
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
] as const satisfies ReadonlyArray<keyof SlowTradingAccountTradingConfig>;

const STRATEGY_FIELD_KEYS = [
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
] as const satisfies ReadonlyArray<keyof SlowTradingAccountTradingConfig>;

const SHARED_STRATEGY_FIELD_KEYS = [
  "minimalAssetOnTrade",
  "safePercentPerMonth",
  "safeUSDTPerMonth",
] as const;

const SHARED_CONFIG_KEYS = [
  "blackSwan",
  "decisionEngineVersion",
  "description",
  "exchangeType",
  "name",
  "symbols",
  "tradingMode",
] as const satisfies ReadonlyArray<keyof DynamicTradeConfig>;

/** Extracts exactly the settings owned by the Trading tab. */
function fromEffectiveConfig(
  config: DynamicTradeConfig,
  notes = "",
): SlowTradingAccountTradingConfig {
  const trading = {
    notes: typeof notes === "string" ? notes : "",
  } as SlowTradingAccountTradingConfig;

  for (const key of DYNAMIC_CONFIG_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      Object.assign(trading, { [key]: clone(value) });
    }
  }

  for (const key of STRATEGY_FIELD_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      Object.assign(trading, { [key]: clone(value) });
    }
  }

  return trading;
}

/** Overlays one account's Trading-tab settings onto the shared SLOW config. */
function toEffectiveConfig(
  sharedConfig: DynamicTradeConfig,
  account: Pick<SlowTradingAccount, "trading">,
): DynamicTradeConfig {
  const trading = clone(account.trading) as Record<string, unknown>;
  const accountConfig: Partial<DynamicTradeConfig> = {};

  for (const key of [...DYNAMIC_CONFIG_KEYS, ...STRATEGY_FIELD_KEYS]) {
    const value = trading[key];
    if (value !== undefined) {
      Object.assign(accountConfig, { [key]: clone(value) });
    }
  }

  return {
    ...clone(sharedConfig),
    ...accountConfig,
  };
}

/** Replaces only the per-account Trading-tab settings from an effective config. */
function withEffectiveConfig(
  account: SlowTradingAccount,
  config: DynamicTradeConfig,
): SlowTradingAccount {
  return {
    ...account,
    trading: fromEffectiveConfig(config, account.trading.notes),
    updatedAt: Date.now(),
  };
}

/** Replaces only settings owned by shared Management/Black-Swan config. */
function sharedFromEffectiveConfig(
  currentShared: DynamicTradeConfig,
  effectiveConfig: DynamicTradeConfig,
): DynamicTradeConfig {
  const next = clone(currentShared);
  for (const key of SHARED_CONFIG_KEYS) {
    const value = effectiveConfig[key];
    if (value === undefined) {
      delete next[key];
    } else {
      Object.assign(next, { [key]: clone(value) });
    }
  }
  for (const key of SHARED_STRATEGY_FIELD_KEYS) {
    const value = effectiveConfig[key];
    if (value === undefined) {
      delete next[key];
    } else {
      Object.assign(next, { [key]: clone(value) });
    }
  }
  return next;
}

/** Selects only config.json-owned fields from a complete effective config. */
function toPersistedSharedConfig(
  config: DynamicTradeConfig,
): SlowTradingManagementConfig {
  const persisted: SlowTradingManagementConfig = {
    name: config.name,
    description: config.description,
    symbols: clone(config.symbols),
    minimalAssetOnTrade: config.minimalAssetOnTrade,
    safePercentPerMonth: config.safePercentPerMonth,
    safeUSDTPerMonth: config.safeUSDTPerMonth,
    exchangeType: config.exchangeType,
    tradingMode: config.tradingMode,
  };

  if (config.decisionEngineVersion !== undefined) {
    persisted.decisionEngineVersion = config.decisionEngineVersion;
  }
  if (config.blackSwan !== undefined) {
    persisted.blackSwan = clone(config.blackSwan);
  }

  return persisted;
}

const slowTradingAccountConfig = {
  shared: {
    fromEffectiveConfig: sharedFromEffectiveConfig,
    toPersistedConfig: toPersistedSharedConfig,
  },
  trading: {
    fromEffectiveConfig,
    keys: {
      dynamic: DYNAMIC_CONFIG_KEYS,
      strategy: STRATEGY_FIELD_KEYS,
    },
    toEffectiveConfig,
    withEffectiveConfig,
  },
} as const;

export default slowTradingAccountConfig;
