import { FILES } from "@/components/storage";
import { DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION } from "@/lib/dynamic";
import {
  createNotificationTypeConfig,
  createDefaultDashboardNotificationConfig,
  normalizeDashboardNotificationConfig,
} from "@/lib/notification/config";
import adaptiveAveraging from "@/lib/trading/adaptive-averaging";
import blackSwan from "@/lib/trading/black-swan";
import fs from "fs-extra";
import {
  createDefaultSlowTradingAccounts,
  loadSlowTradingExchangeAccounts,
  normalizeExchangeAccountSlug,
  saveSlowTradingExchangeAccounts,
} from "./account";
import slowTradingAccountConfig from "../account-config";
import { clone, uniqueSymbols } from "./common";
import {
  DEFAULT_SAFE_HAVEN_CONFIG,
  DEFAULT_WITHDRAWAL_CONFIG,
} from "./constants";
import slowTradingJsonFile from "./json-file";
import {
  hydrateSlowTradingHistoryFromFiles,
  persistClosedPositionsToHistoryFiles,
} from "./history-files";
import type {
  SlowTradingConfigFileData,
  SlowTradingMemoryFileData,
} from "./internal-types";
import { appendSlowTradingSafeHavenLog } from "./logs";
import {
  applySlowTradingSafeHavenUpdate,
  createDefaultModeStates,
  createModeState,
  ensureTradeSettings,
  fromPersistedModeState,
  getActiveSlowTradingMode,
  toPersistedModeState,
} from "./mode";
import { normalizeWithdrawalConfig } from "./withdrawal-config";
import { normalizeSafeHavenConfig } from "./safe-haven-config";
import { DEFAULT_MCP_CONFIG, normalizeMcpConfig } from "./mcp-config";
import type {
  SlowTradingMode,
  SlowTradingStorageData,
  SlowTradingStorageUpdateInput,
} from "../types";
import slowTradingPnlHistory from "../pnl-history";
import slowTradingStages from "../stages";
import slowTradingDailyPnlLimit from "../daily-pnl-limit";

const DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT = 15;

const RUNTIME_KEYS = [
  "autoEntryDailyPnlLimitUSDT",
  "autoEntryEnabled",
  "autoExitEnabled",
  "autoRemoveSymbolAbsLevel",
  "autoRemoveSymbolMinMarketCapUSD",
  "autoRemoveSymbolMinPrice",
  "autoRemoveSymbolMinVPointPct",
  "blackSwanStageIntervalMinutes",
  "captureEntryStageIntervalMinutes",
  "entrySignalBypass",
  "managementStageIntervalMinutes",
  "mcp",
  "notification",
  "pnlHistoryBucketMinutes",
  "runnerEnabled",
  "safeHaven",
  "sandboxEnabled",
  "speedupStageIntervalMinutes",
  "speedupStageNegativePnlThresholdPct",
  "speedupStagePositivePnlThresholdPct",
  "speedupStageTakeProfitOffsetPct",
  "standardMonitoringStageIntervalMinutes",
  "withdrawal",
] as const satisfies ReadonlyArray<
  keyof SlowTradingStorageData["runtime"]
>;

/**
 * Copies only known runtime keys from persisted JSON; unknown persisted keys
 * are intentionally dropped so they disappear on the next save.
 */
function pickPersistedRuntime(
  raw: Partial<SlowTradingConfigFileData["runtime"]> | undefined,
  baseRuntime: SlowTradingStorageData["runtime"],
): SlowTradingStorageData["runtime"] {
  const runtime: Record<keyof SlowTradingStorageData["runtime"], unknown> = {
    ...baseRuntime,
  };
  for (const key of RUNTIME_KEYS) {
    const value = raw?.[key];
    if (value !== undefined) {
      runtime[key] = value;
    }
  }
  return runtime as SlowTradingStorageData["runtime"];
}

/** Enables the new daily-PnL notification once for configs predating its threshold field. */
function normalizeRuntimeNotification(
  value: unknown,
  enableDailyPnlLimitByDefault: boolean,
): SlowTradingStorageData["runtime"]["notification"] {
  const notification = normalizeDashboardNotificationConfig(value, "SLOW");
  if (!enableDailyPnlLimitByDefault) {
    return notification;
  }

  for (const channel of ["telegram", "email"] as const) {
    if (
      !notification[channel].types.some(
        (item) => item.id === "NOTIF_DAILY_PNL_LIMIT",
      )
    ) {
      notification[channel].types.push(
        createNotificationTypeConfig("NOTIF_DAILY_PNL_LIMIT"),
      );
    }
  }

  return notification;
}

interface LoadSlowTradingStorageOptions {
  /** Project config and mode memory for this account instead of UI selection. */
  account?: string;
  /** Hydrate closed trade history from split files into positionsSell. */
  includeHistory?: boolean;
  /** Load every mode or only the active mode needed by runner/runtime paths. */
  modeScope?: "all" | "active";
}

/**
 * Create the default SLOW strategy config without allocating mode memory.
 */
function createDefaultSlowTradingConfig(): SlowTradingStorageData["config"] {
  const symbols = uniqueSymbols(
    DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION.symbols,
  );

  return {
    ...clone(DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION),
    symbols,
    blackSwan: blackSwan.config.normalize(
      DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION.blackSwan,
    ),
  };
}

/**
 * Create the default SLOW runtime config without allocating mode memory.
 */
function createDefaultSlowTradingRuntime(): SlowTradingStorageData["runtime"] {
  return {
    runnerEnabled: false,
    autoEntryEnabled: false,
    autoEntryDailyPnlLimitUSDT:
      slowTradingDailyPnlLimit.config.defaultThresholdUsdt,
    autoExitEnabled: false,
    entrySignalBypass: false,
    autoRemoveSymbolAbsLevel: 0,
    autoRemoveSymbolMinMarketCapUSD: 0,
    autoRemoveSymbolMinPrice: 0,
    autoRemoveSymbolMinVPointPct:
      DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT,
    pnlHistoryBucketMinutes:
      slowTradingPnlHistory.bucket.defaultMinutes,
    blackSwanStageIntervalMinutes:
      slowTradingStages.interval.defaults["risk-sentinel"],
    speedupStageIntervalMinutes:
      slowTradingStages.interval.defaults.speedup,
    speedupStagePositivePnlThresholdPct:
      slowTradingStages.position.speedupThreshold.defaults.positivePct,
    speedupStageNegativePnlThresholdPct:
      slowTradingStages.position.speedupThreshold.defaults.negativePct,
    speedupStageTakeProfitOffsetPct:
      slowTradingStages.position.speedupThreshold.defaults.takeProfitOffsetPct,
    standardMonitoringStageIntervalMinutes:
      slowTradingStages.interval.defaults["standard-monitoring"],
    managementStageIntervalMinutes:
      slowTradingStages.interval.defaults.management,
    captureEntryStageIntervalMinutes:
      slowTradingStages.interval.defaults["capture-entry"],
    notification: createDefaultDashboardNotificationConfig("SLOW"),
    sandboxEnabled: false,
    withdrawal: clone(DEFAULT_WITHDRAWAL_CONFIG),
    safeHaven: clone(DEFAULT_SAFE_HAVEN_CONFIG),
    mcp: clone(DEFAULT_MCP_CONFIG),
  };
}

/**
 * Normalize the symbol auto-removal threshold.
 */
function normalizeAutoRemoveSymbolAbsLevel(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/**
 * Normalize the minimum market price used by coin auto-removal and entry guard.
 */
function normalizeAutoRemoveSymbolMinPrice(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

/** Normalize the minimum USD market cap used by coin auto-removal. */
function normalizeAutoRemoveSymbolMinMarketCapUSD(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

/** Normalize the stored-vPoint percent threshold used by coin auto-removal. */
function normalizeAutoRemoveSymbolMinVPointPct(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT;
  }

  return Math.max(0, parsed);
}

/**
 * Normalize the portfolio-wide open-position entry limit.
 */
function normalizeMaxOpenPositions(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/** Applies defaults and bounds to production stage runtime settings. */
function normalizeStageRuntimeConfig(
  runtime: SlowTradingStorageData["runtime"],
): void {
  runtime.blackSwanStageIntervalMinutes =
    slowTradingStages.interval.normalizeMinutes(
      runtime.blackSwanStageIntervalMinutes,
      slowTradingStages.interval.defaults["risk-sentinel"],
    );
  runtime.speedupStageIntervalMinutes =
    slowTradingStages.interval.normalizeMinutes(
      runtime.speedupStageIntervalMinutes,
      slowTradingStages.interval.defaults.speedup,
    );
  runtime.standardMonitoringStageIntervalMinutes =
    slowTradingStages.interval.normalizeMinutes(
      runtime.standardMonitoringStageIntervalMinutes,
      slowTradingStages.interval.defaults["standard-monitoring"],
    );
  runtime.managementStageIntervalMinutes =
    slowTradingStages.interval.normalizeMinutes(
      runtime.managementStageIntervalMinutes,
      slowTradingStages.interval.defaults.management,
    );
  runtime.captureEntryStageIntervalMinutes =
    slowTradingStages.interval.normalizeMinutes(
      runtime.captureEntryStageIntervalMinutes,
      slowTradingStages.interval.defaults["capture-entry"],
    );
  runtime.speedupStagePositivePnlThresholdPct =
    slowTradingStages.position.speedupThreshold.normalizePct(
      runtime.speedupStagePositivePnlThresholdPct,
      slowTradingStages.position.speedupThreshold.defaults.positivePct,
    );
  runtime.speedupStageNegativePnlThresholdPct =
    slowTradingStages.position.speedupThreshold.normalizePct(
      runtime.speedupStageNegativePnlThresholdPct,
      slowTradingStages.position.speedupThreshold.defaults.negativePct,
    );
  runtime.speedupStageTakeProfitOffsetPct =
    slowTradingStages.position.speedupThreshold.normalizePct(
      runtime.speedupStageTakeProfitOffsetPct,
      slowTradingStages.position.speedupThreshold.defaults.takeProfitOffsetPct,
    );
}

/**
 * Create the default persisted storage shape for slow trading.
 *
 * @returns Fresh storage object with live and sandbox mode state.
 */
export function createDefaultSlowTradingStorage(): SlowTradingStorageData {
  const sharedConfig = createDefaultSlowTradingConfig();
  const runtime = createDefaultSlowTradingRuntime();
  const accounts = createDefaultSlowTradingAccounts(sharedConfig);
  const account = accounts[0];
  if (!account) {
    throw new Error("SLOW requires at least one exchange account");
  }
  const config = slowTradingAccountConfig.trading.toEffectiveConfig(
    sharedConfig,
    account,
  );

  return {
    account,
    accounts,
    sharedConfig,
    config,
    runtime,
    modes: createDefaultModeStates(
      config.symbols,
      account.sandbox.initialBalanceUSDT,
    ),
    updatedAt: Date.now(),
  };
}

/**
 * Rejects pre-flat memory.json shapes instead of silently losing their
 * positions. Only existing account/mode entries are checked.
 */
function assertPersistedMemoryShape(
  memoryRaw: Partial<SlowTradingMemoryFileData>,
): void {
  for (const [slug, modes] of Object.entries(memoryRaw.accounts ?? {})) {
    for (const mode of ["live", "sandbox"] as const) {
      const state = modes?.[mode];
      if (state === undefined || state === null) continue;
      if (
        !Array.isArray(state.positions) ||
        Object.prototype.hasOwnProperty.call(state, "tradeSettings")
      ) {
        throw new Error(
          `Unsupported memory.json mode shape for ${slug}/${mode}; expected flat positions.`,
        );
      }
    }
  }
}

/**
 * Normalizes a persisted mode only when the caller needs it in memory.
 */
function loadModeStateForScope(params: {
  accountSlug: string;
  mode: SlowTradingMode;
  activeMode: SlowTradingMode;
  memoryRaw: Partial<SlowTradingMemoryFileData>;
  modeScope: "all" | "active";
  sandboxInitialBalanceUSDT: number;
  symbols: string[];
}): SlowTradingStorageData["modes"][SlowTradingMode] {
  const initialBalanceUSDT =
    params.mode === "sandbox"
      ? params.sandboxInitialBalanceUSDT
      : 0;

  if (params.modeScope === "active" && params.mode !== params.activeMode) {
    return createModeState(initialBalanceUSDT);
  }

  const base = toPersistedModeState(createModeState(initialBalanceUSDT));
  return fromPersistedModeState(
    {
      ...base,
      ...(params.memoryRaw.accounts?.[params.accountSlug]?.[params.mode] ??
        {}),
    },
    params.symbols,
  );
}

/**
 * Split the full slow-trading storage object into config/runtime and mode-memory files.
 *
 * @param storage - Full slow-trading storage state.
 * @returns Persistable config and memory payloads.
 */
function splitSlowTradingStorage(
  storage: SlowTradingStorageData,
  memoryRaw: Partial<SlowTradingMemoryFileData> = {},
): {
  accounts: SlowTradingStorageData["accounts"];
  configFile: SlowTradingConfigFileData;
  memoryFile: SlowTradingMemoryFileData;
} {
  const sharedConfig = slowTradingAccountConfig.shared.fromEffectiveConfig(
    storage.sharedConfig,
    storage.config,
  );
  const account = slowTradingAccountConfig.trading.withEffectiveConfig(
    storage.account,
    storage.config,
  );
  const accounts = storage.accounts.map((candidate) =>
    candidate.slug === account.slug ? account : candidate,
  );

  return {
    accounts,
    configFile: {
      // PROD:MULTI_ACCOUNT_CONFIG_OWNERSHIP
      management:
        slowTradingAccountConfig.shared.toPersistedConfig(sharedConfig),
      runtime: clone(storage.runtime),
      updatedAt: storage.updatedAt,
    },
    memoryFile: {
      accounts: {
        ...(memoryRaw.accounts ?? {}),
        [account.slug]: {
          live: toPersistedModeState(storage.modes.live),
          sandbox: toPersistedModeState(storage.modes.sandbox),
        },
      },
      updatedAt: storage.updatedAt,
    },
  };
}

/**
 * Persist the current storage object into the new split-file slow-trading format.
 *
 * @param storage - Full slow-trading storage state.
 * @returns Promise that resolves when both files are written.
 */
async function saveSplitSlowTradingStorage(
  storage: SlowTradingStorageData,
): Promise<void> {
  const normalized = {
    ...storage,
    updatedAt: Date.now(),
  };
  const memoryRaw = (await fs.pathExists(FILES.slow.memory))
    ? ((await fs.readJSON(
        FILES.slow.memory,
      )) as Partial<SlowTradingMemoryFileData>)
    : {};
  assertPersistedMemoryShape(memoryRaw);
  const { accounts, configFile, memoryFile } = splitSlowTradingStorage(
    normalized,
    memoryRaw,
  );

  await slowTradingJsonFile.write.atomic(FILES.slow.config, configFile);
  await slowTradingJsonFile.write.atomic(FILES.slow.memory, memoryFile);
  await saveSlowTradingExchangeAccounts(accounts, normalized.sharedConfig);
}

/**
 * Reads the split config file with current defaults applied.
 */
async function loadSlowTradingConfigFile(accountSlug?: string): Promise<{
  account: SlowTradingStorageData["account"];
  accounts: SlowTradingStorageData["accounts"];
  config: SlowTradingStorageData["config"];
  sharedConfig: SlowTradingStorageData["sharedConfig"];
  runtime: SlowTradingStorageData["runtime"];
  updatedAt: number;
}> {
  const hasConfigFile = await fs.pathExists(FILES.slow.config);
  const configRaw = hasConfigFile
    ? ((await fs.readJSON(
        FILES.slow.config,
      )) as Partial<SlowTradingConfigFileData>)
    : {};
  const baseConfig = createDefaultSlowTradingConfig();
  const baseRuntime = createDefaultSlowTradingRuntime();
  const sharedConfig = {
    ...baseConfig,
    ...(configRaw.management ?? {}),
    minimalAssetOnTrade: hasConfigFile
      ? configRaw.management?.minimalAssetOnTrade
      : baseConfig.minimalAssetOnTrade,
    safePercentPerMonth: hasConfigFile
      ? configRaw.management?.safePercentPerMonth
      : baseConfig.safePercentPerMonth,
    safeUSDTPerMonth: hasConfigFile
      ? configRaw.management?.safeUSDTPerMonth
      : baseConfig.safeUSDTPerMonth,
    adaptiveAveraging: adaptiveAveraging.config.normalize(
      baseConfig.adaptiveAveraging,
    ),
    blackSwan: blackSwan.config.normalize(
      configRaw.management?.blackSwan ?? baseConfig.blackSwan,
    ),
    maxOpenPositions: normalizeMaxOpenPositions(baseConfig.maxOpenPositions),
    symbols: uniqueSymbols(
      configRaw.management?.symbols ?? baseConfig.symbols,
    ),
  };
  const exchangeAccounts = await loadSlowTradingExchangeAccounts(
    sharedConfig,
  );
  const runtime = pickPersistedRuntime(configRaw.runtime, baseRuntime);
  runtime.notification = normalizeRuntimeNotification(
    runtime.notification,
    configRaw.runtime?.autoEntryDailyPnlLimitUSDT === undefined,
  );
  runtime.withdrawal = normalizeWithdrawalConfig(runtime.withdrawal);
  runtime.safeHaven = normalizeSafeHavenConfig(
    runtime.safeHaven,
    sharedConfig,
  );
  runtime.mcp = normalizeMcpConfig(runtime.mcp);
  const requestedSlug = normalizeExchangeAccountSlug(accountSlug);
  const account =
    exchangeAccounts.find(
      (candidate) => candidate.slug === requestedSlug,
    ) ?? exchangeAccounts[0];
  if (!account) throw new Error("SLOW requires at least one exchange account");
  runtime.sandboxEnabled = runtime.sandboxEnabled === true;
  const config = slowTradingAccountConfig.trading.toEffectiveConfig(
    sharedConfig,
    account,
  );

  runtime.autoEntryDailyPnlLimitUSDT =
    slowTradingDailyPnlLimit.config.normalizeThresholdUsdt(
      runtime.autoEntryDailyPnlLimitUSDT,
    );
  runtime.autoRemoveSymbolAbsLevel = normalizeAutoRemoveSymbolAbsLevel(
    runtime.autoRemoveSymbolAbsLevel,
  );
  runtime.autoRemoveSymbolMinPrice = normalizeAutoRemoveSymbolMinPrice(
    runtime.autoRemoveSymbolMinPrice,
  );
  runtime.autoRemoveSymbolMinMarketCapUSD =
    normalizeAutoRemoveSymbolMinMarketCapUSD(
      runtime.autoRemoveSymbolMinMarketCapUSD,
    );
  runtime.autoRemoveSymbolMinVPointPct =
    normalizeAutoRemoveSymbolMinVPointPct(
      runtime.autoRemoveSymbolMinVPointPct,
    );
  runtime.pnlHistoryBucketMinutes =
    slowTradingPnlHistory.bucket.normalizeMinutes(
      runtime.pnlHistoryBucketMinutes,
    );
  normalizeStageRuntimeConfig(runtime);

  return {
    account,
    accounts: exchangeAccounts,
    config,
    sharedConfig,
    runtime,
    updatedAt: configRaw.updatedAt ?? Date.now(),
  };
}

/**
 * Load slow-trading storage from disk and normalize missing/default fields.
 *
 * @param options - Optional history hydration controls.
 * @returns Hydrated slow-trading storage object.
 */
export async function loadSlowTradingStorage(
  options: LoadSlowTradingStorageOptions = {},
): Promise<SlowTradingStorageData> {
  const hasConfigFile = await fs.pathExists(FILES.slow.config);
  const hasMemoryFile = await fs.pathExists(FILES.slow.memory);

  // A. Create brand-new split files only when both files are still missing.
  if (!hasConfigFile && !hasMemoryFile) {
    const initial = createDefaultSlowTradingStorage();
    await saveSlowTradingStorage(initial);
    if (options.includeHistory) {
      await hydrateSlowTradingHistoryFromFiles(initial);
    }
    return initial;
  }

  // B. Merge persisted split-file data on top of the latest defaults.
  // B.1 Read whichever file already exists when only part of the pair is present.
  const memoryRaw = hasMemoryFile
    ? ((await fs.readJSON(
        FILES.slow.memory,
      )) as Partial<SlowTradingMemoryFileData>)
    : {};
  assertPersistedMemoryShape(memoryRaw);
  const {
    account,
    accounts,
    config,
    sharedConfig,
    runtime,
    updatedAt: configUpdatedAt,
  } = await loadSlowTradingConfigFile(options.account);
  const sandboxInitialBalanceUSDT = account.sandbox.initialBalanceUSDT;

  const activeMode: SlowTradingMode = runtime.sandboxEnabled
    ? "sandbox"
    : "live";
  const effectiveModeScope =
    !hasConfigFile || !hasMemoryFile
      ? "all"
      : options.modeScope ?? "all";

  const storage: SlowTradingStorageData = {
    account,
    accounts,
    sharedConfig,
    config,
    runtime,
    modes: {
      live: loadModeStateForScope({
        accountSlug: account.slug,
        mode: "live",
        activeMode,
        memoryRaw,
        modeScope: effectiveModeScope,
        sandboxInitialBalanceUSDT,
        symbols: config.symbols,
      }),
      sandbox: loadModeStateForScope({
        accountSlug: account.slug,
        mode: "sandbox",
        activeMode,
        memoryRaw,
        modeScope: effectiveModeScope,
        sandboxInitialBalanceUSDT,
        symbols: config.symbols,
      }),
    },
    updatedAt: configUpdatedAt ?? memoryRaw.updatedAt ?? Date.now(),
  };

  // B.2 Seed sandbox balance when this is an old file with no initialized memory yet.
  if (
    effectiveModeScope === "all" &&
    !storage.modes.sandbox.dynamicTradeMemory.startingBalanceUSDT &&
    storage.modes.sandbox.tradeSettings.every(
      (item) =>
        (item.model_memory.positions?.length ?? 0) === 0 &&
        (item.model_memory.positionsSell?.length ?? 0) === 0,
    )
  ) {
    storage.modes.sandbox.dynamicTradeMemory.startingBalanceUSDT =
      sandboxInitialBalanceUSDT;
    storage.modes.sandbox.dynamicTradeMemory.quoteAsset =
      sandboxInitialBalanceUSDT;
  }

  // B.3 Heal partial split storage by re-saving the fully normalized pair.
  if (
    effectiveModeScope === "all" &&
    (!hasConfigFile || !hasMemoryFile)
  ) {
    await saveSlowTradingStorage(storage);
  }

  if (options.includeHistory) {
    await hydrateSlowTradingHistoryFromFiles(storage);
  }

  return storage;
}

/**
 * Persist the full slow-trading storage payload to disk.
 *
 * @param storage - Storage state to save.
 * @returns Promise that resolves when the file has been written.
 */
export async function saveSlowTradingStorage(
  storage: SlowTradingStorageData,
): Promise<void> {
  await saveSplitSlowTradingStorage(storage);
}

/** Removes orphaned live/sandbox memory after a dependency-safe account deletion. */
export async function deleteSlowTradingAccountState(
  accountSlug: string,
): Promise<void> {
  if (!(await fs.pathExists(FILES.slow.memory))) return;
  const memory = (await fs.readJSON(
    FILES.slow.memory,
  )) as Partial<SlowTradingMemoryFileData>;
  assertPersistedMemoryShape(memory);
  if (!memory.accounts?.[accountSlug]) return;
  const accounts = { ...memory.accounts };
  delete accounts[accountSlug];
  await slowTradingJsonFile.write.atomic(FILES.slow.memory, {
    accounts,
    updatedAt: Date.now(),
  } satisfies SlowTradingMemoryFileData);
}

/**
 * Persist one mode's execution memory while preserving the latest config/runtime.
 *
 * Long-running cycles can start from an older runtime snapshot. Re-loading before
 * the final write keeps UI settings changes from being overwritten by that cycle.
 *
 * @param mode - Mode whose memory should be replaced.
 * @param modeState - Updated mode memory to persist.
 * @returns Latest storage after the mode memory has been saved.
 */
export async function saveSlowTradingModeState(
  mode: "live" | "sandbox",
  modeState: SlowTradingStorageData["modes"]["live"],
  options: { account?: string } = {},
): Promise<SlowTradingStorageData> {
  const { account, accounts, config, sharedConfig, runtime, updatedAt } =
    await loadSlowTradingConfigFile(options.account);
  const hasMemoryFile = await fs.pathExists(FILES.slow.memory);
  const memoryRaw = hasMemoryFile
    ? ((await fs.readJSON(
        FILES.slow.memory,
      )) as Partial<SlowTradingMemoryFileData>)
    : {};
  assertPersistedMemoryShape(memoryRaw);
  const sandboxInitialBalanceUSDT = account.sandbox.initialBalanceUSDT;
  const targetModeState = ensureTradeSettings(modeState, config.symbols);
  await persistClosedPositionsToHistoryFiles(mode, targetModeState);

  const fallbackModes = memoryRaw.accounts?.[account.slug] ?? {
    live: toPersistedModeState(createModeState(0)),
    sandbox: toPersistedModeState(createModeState(sandboxInitialBalanceUSDT)),
  };
  // PROD:MULTI_ACCOUNT_STATE_ISOLATION
  const nextMemory: SlowTradingMemoryFileData = {
    accounts: {
      ...(memoryRaw.accounts ?? {}),
      [account.slug]: {
        live:
          mode === "live"
            ? toPersistedModeState(targetModeState)
            : fallbackModes.live ?? toPersistedModeState(createModeState(0)),
        sandbox:
          mode === "sandbox"
            ? toPersistedModeState(targetModeState)
            : fallbackModes.sandbox ??
              toPersistedModeState(createModeState(sandboxInitialBalanceUSDT)),
      },
    },
    updatedAt: Date.now(),
  };

  await slowTradingJsonFile.write.atomic(FILES.slow.memory, nextMemory);

  return {
    account,
    accounts,
    config,
    sharedConfig,
    runtime,
    modes: {
      live:
        mode === "live"
          ? targetModeState
          : loadModeStateForScope({
              accountSlug: account.slug,
              mode: "live",
              activeMode: mode,
              memoryRaw: nextMemory,
              modeScope: "active",
              sandboxInitialBalanceUSDT,
              symbols: config.symbols,
            }),
      sandbox:
        mode === "sandbox"
          ? targetModeState
          : loadModeStateForScope({
              accountSlug: account.slug,
              mode: "sandbox",
              activeMode: mode,
              memoryRaw: nextMemory,
              modeScope: "active",
              sandboxInitialBalanceUSDT,
              symbols: config.symbols,
            }),
    },
    updatedAt,
  };
}

/**
 * Apply a partial config/runtime update and persist the resulting storage.
 *
 * @param update - Partial storage update payload.
 * @returns Updated storage state after persistence.
 */
export async function updateSlowTradingStorage(
  update: SlowTradingStorageUpdateInput,
): Promise<SlowTradingStorageData> {
  const requestedAccount = normalizeExchangeAccountSlug(
    update.account,
  );
  const storage = await loadSlowTradingStorage({
    account: requestedAccount || undefined,
  });
  let safeHavenLog: Parameters<typeof appendSlowTradingSafeHavenLog>[0] | null =
    null;

  // A. Apply strategy-config updates.
  if (update.config) {
    storage.config = {
      ...storage.config,
      ...update.config,
      maxOpenPositions: normalizeMaxOpenPositions(
        update.config.maxOpenPositions ?? storage.config.maxOpenPositions,
      ),
      blackSwan: blackSwan.config.normalize(
        update.config.blackSwan ?? storage.config.blackSwan,
      ),
    };
    storage.sharedConfig =
      slowTradingAccountConfig.shared.fromEffectiveConfig(
        storage.sharedConfig,
        storage.config,
      );
    storage.account = slowTradingAccountConfig.trading.withEffectiveConfig(
      storage.account,
      storage.config,
    );
  }

  // B. Apply legacy top-level update fields kept for API compatibility.
  if (update.exchangeType) {
    storage.config.exchangeType = update.exchangeType;
  }

  if (typeof update.sandboxEnabled === "boolean") {
    storage.runtime.sandboxEnabled = update.sandboxEnabled;
  }

  if (typeof update.runnerEnabled === "boolean") {
    storage.runtime.runnerEnabled = update.runnerEnabled;
  }

  if (typeof update.autoEntryEnabled === "boolean") {
    storage.runtime.autoEntryEnabled = update.autoEntryEnabled;
  }

  if (update.autoEntryDailyPnlLimitUSDT !== undefined) {
    storage.runtime.autoEntryDailyPnlLimitUSDT =
      slowTradingDailyPnlLimit.config.normalizeThresholdUsdt(
        update.autoEntryDailyPnlLimitUSDT,
      );
  }

  if (typeof update.autoExitEnabled === "boolean") {
    storage.runtime.autoExitEnabled = update.autoExitEnabled;
  }

  if (typeof update.entrySignalBypass === "boolean") {
    storage.runtime.entrySignalBypass = update.entrySignalBypass;
  }

  if (typeof update.autoRemoveSymbolAbsLevel === "number") {
    storage.runtime.autoRemoveSymbolAbsLevel =
      normalizeAutoRemoveSymbolAbsLevel(update.autoRemoveSymbolAbsLevel);
  }

  if (typeof update.autoRemoveSymbolMinPrice === "number") {
    storage.runtime.autoRemoveSymbolMinPrice =
      normalizeAutoRemoveSymbolMinPrice(update.autoRemoveSymbolMinPrice);
  }

  if (typeof update.autoRemoveSymbolMinMarketCapUSD === "number") {
    storage.runtime.autoRemoveSymbolMinMarketCapUSD =
      normalizeAutoRemoveSymbolMinMarketCapUSD(
        update.autoRemoveSymbolMinMarketCapUSD,
      );
  }

  if (typeof update.autoRemoveSymbolMinVPointPct === "number") {
    storage.runtime.autoRemoveSymbolMinVPointPct =
      normalizeAutoRemoveSymbolMinVPointPct(
        update.autoRemoveSymbolMinVPointPct,
      );
  }

  if (update.pnlHistoryBucketMinutes !== undefined) {
    storage.runtime.pnlHistoryBucketMinutes =
      slowTradingPnlHistory.bucket.normalizeMinutes(
        update.pnlHistoryBucketMinutes,
      );
  }

  if (update.speedupStageIntervalMinutes !== undefined) {
    storage.runtime.speedupStageIntervalMinutes =
      slowTradingStages.interval.normalizeMinutes(
        update.speedupStageIntervalMinutes,
        slowTradingStages.interval.defaults.speedup,
      );
  }

  if (update.blackSwanStageIntervalMinutes !== undefined) {
    storage.runtime.blackSwanStageIntervalMinutes =
      slowTradingStages.interval.normalizeMinutes(
        update.blackSwanStageIntervalMinutes,
        slowTradingStages.interval.defaults["risk-sentinel"],
      );
  }

  if (update.speedupStagePositivePnlThresholdPct !== undefined) {
    storage.runtime.speedupStagePositivePnlThresholdPct =
      slowTradingStages.position.speedupThreshold.normalizePct(
        update.speedupStagePositivePnlThresholdPct,
        slowTradingStages.position.speedupThreshold.defaults.positivePct,
      );
  }

  if (update.speedupStageNegativePnlThresholdPct !== undefined) {
    storage.runtime.speedupStageNegativePnlThresholdPct =
      slowTradingStages.position.speedupThreshold.normalizePct(
        update.speedupStageNegativePnlThresholdPct,
        slowTradingStages.position.speedupThreshold.defaults.negativePct,
      );
  }

  if (update.speedupStageTakeProfitOffsetPct !== undefined) {
    storage.runtime.speedupStageTakeProfitOffsetPct =
      slowTradingStages.position.speedupThreshold.normalizePct(
        update.speedupStageTakeProfitOffsetPct,
        slowTradingStages.position.speedupThreshold.defaults
          .takeProfitOffsetPct,
      );
  }

  if (update.standardMonitoringStageIntervalMinutes !== undefined) {
    storage.runtime.standardMonitoringStageIntervalMinutes =
      slowTradingStages.interval.normalizeMinutes(
        update.standardMonitoringStageIntervalMinutes,
        slowTradingStages.interval.defaults["standard-monitoring"],
      );
  }

  if (update.managementStageIntervalMinutes !== undefined) {
    storage.runtime.managementStageIntervalMinutes =
      slowTradingStages.interval.normalizeMinutes(
        update.managementStageIntervalMinutes,
        slowTradingStages.interval.defaults.management,
      );
  }

  if (update.captureEntryStageIntervalMinutes !== undefined) {
    storage.runtime.captureEntryStageIntervalMinutes =
      slowTradingStages.interval.normalizeMinutes(
        update.captureEntryStageIntervalMinutes,
        slowTradingStages.interval.defaults["capture-entry"],
      );
  }

  if (update.notification !== undefined) {
    storage.runtime.notification = normalizeDashboardNotificationConfig(
      update.notification,
      "SLOW",
    );
  }

  storage.account = {
    ...storage.account,
    updatedAt: Date.now(),
  };
  storage.accounts = storage.accounts.map(
    (account) =>
      account.slug === storage.account.slug ? storage.account : account,
  );

  if (update.withdrawal !== undefined) {
    storage.runtime.withdrawal = normalizeWithdrawalConfig({
      ...storage.runtime.withdrawal,
      ...update.withdrawal,
    });
  }

  if (update.safeHaven !== undefined) {
    storage.runtime.safeHaven = normalizeSafeHavenConfig({
      ...storage.runtime.safeHaven,
      ...update.safeHaven,
    });
  }

  if (update.mcp !== undefined) {
    storage.runtime.mcp = normalizeMcpConfig({
      ...storage.runtime.mcp,
      ...update.mcp,
    });
  }

  if (update.symbols) {
    storage.config.symbols = uniqueSymbols(update.symbols);
  }

  storage.sharedConfig = slowTradingAccountConfig.shared.fromEffectiveConfig(
    storage.sharedConfig,
    storage.config,
  );
  storage.account = slowTradingAccountConfig.trading.withEffectiveConfig(
    storage.account,
    storage.config,
  );

  // C. Rebuild per-mode trade settings after config changes, then persist.
  storage.modes.live = ensureTradeSettings(
    storage.modes.live,
    storage.config.symbols,
  );
  storage.modes.sandbox = ensureTradeSettings(
    storage.modes.sandbox,
    storage.config.symbols,
  );

  if (typeof update.safeHavenUSDT === "number") {
    const activeMode = getActiveSlowTradingMode(storage);
    const { nextUSDT: nextSafeHavenUSDT, previousUSDT: previousSafeHavenUSDT } =
      applySlowTradingSafeHavenUpdate(
        storage.modes[activeMode],
        update.safeHavenUSDT,
      );

    if (Math.abs(previousSafeHavenUSDT - nextSafeHavenUSDT) > 1e-9) {
      safeHavenLog = {
        account: storage.account.slug,
        mode: activeMode,
        previousUSDT: previousSafeHavenUSDT,
        nextUSDT: nextSafeHavenUSDT,
        source: update.safeHavenLogSource ?? "manual_update",
        reason: update.safeHavenLogReason,
      };
    }
  }

  await saveSlowTradingStorage(storage);
  if (safeHavenLog) {
    await appendSlowTradingSafeHavenLog(safeHavenLog);
  }

  return storage;
}

/**
 * Reset the sandbox mode state while keeping the configured initial balance.
 *
 * @returns Storage state after sandbox reset.
 */
export async function resetSandboxSlowTrading(params?: {
  account?: string;
  initialBalanceUSDT?: number;
}): Promise<SlowTradingStorageData> {
  const storage = await loadSlowTradingStorage({ account: params?.account });
  if (typeof params?.initialBalanceUSDT === "number") {
    const initialBalanceUSDT = Math.max(0, params.initialBalanceUSDT);
    storage.account = {
      ...storage.account,
      sandbox: { initialBalanceUSDT },
      updatedAt: Date.now(),
    };
    storage.accounts = storage.accounts.map(
      (candidate) =>
        candidate.slug === storage.account.slug ? storage.account : candidate,
    );
  }
  storage.modes.sandbox = ensureTradeSettings(
    createModeState(storage.account.sandbox.initialBalanceUSDT),
    storage.config.symbols,
  );
  // PROD:MULTI_ACCOUNT_SANDBOX_ISOLATION
  await saveSlowTradingStorage(storage);
  return storage;
}
