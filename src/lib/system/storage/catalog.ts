import fs from "fs-extra";

import type { ExchangeType } from "../types";
import { normalizeDashboardNotificationConfig } from "../notification/config";
import blackSwan from "../trading/black-swan";
import runtimeAccountConfig from "../runtime/account-config";
import runtimeAccounts from "../runtime/accounts";
import runtimeDefaults from "../runtime/defaults";
import runtimeNormalize from "../runtime/normalize";
import runtimeStages from "../runtime/stages";
import reporting from "../trading/reporting";
import type {
  RuntimeAccountConfig,
  RuntimeConfig,
  RuntimeControlConfig,
  RuntimeEffectiveConfig,
  RuntimeMcpConfig,
  RuntimeMode,
  RuntimeSafeHavenConfig,
  RuntimeWithdrawalConfig,
} from "../runtime/types";
import storageFiles from "./files";
import jsonFile from "./json-file";
import runtimeLogs from "./logs";
import type { RuntimeConfigChange } from "./logs";
import type { RuntimeAccountModeState } from "./runtime";

/** The storage catalog: shared config plus every persisted account. */
export interface RuntimeStorageCatalog {
  config: RuntimeConfig;
  mode: RuntimeMode;
}

/** Partial update payload accepted by the catalog settings API. */
export interface RuntimeCatalogUpdateInput {
  /** Flat strategy configuration update merged over the effective config. */
  config?: Partial<RuntimeEffectiveConfig>;
  /** Account whose trading config and mode state receive scoped updates. */
  account?: string;
  runnerEnabled?: boolean;
  autoEntryEnabled?: boolean;
  autoEntryDailyPnlLimitUSDT?: number;
  autoExitEnabled?: boolean;
  entrySignalBypass?: boolean;
  autoRemoveSymbolAbsLevel?: number;
  autoRemoveSymbolMinPrice?: number;
  autoRemoveSymbolMinMarketCapUSD?: number;
  autoRemoveSymbolMinVPointPct?: number;
  pnlHistoryBucketMinutes?: number;
  blackSwanStageIntervalMinutes?: number;
  speedupStageIntervalMinutes?: number;
  speedupStagePositivePnlThresholdPct?: number;
  speedupStageNegativePnlThresholdPct?: number;
  speedupStageTakeProfitOffsetPct?: number;
  standardMonitoringStageIntervalMinutes?: number;
  managementStageIntervalMinutes?: number;
  captureEntryStageIntervalMinutes?: number;
  notification?: unknown;
  exchangeType?: ExchangeType;
  sandboxEnabled?: boolean;
  safeHavenLogReason?: string;
  safeHavenLogSource?: string;
  safeHavenUSDT?: number;
  symbols?: string[];
  withdrawal?: Partial<RuntimeWithdrawalConfig>;
  safeHaven?: Partial<RuntimeSafeHavenConfig>;
  mcp?: Partial<RuntimeMcpConfig>;
}

interface RuntimeAccountsFileData {
  accounts: RuntimeAccountConfig[];
  retiredSlugs?: string[];
  updatedAt?: number;
}

/** Bookkeeping leaf keys that churn on every save without real changes. */
const VOLATILE_CONFIG_KEYS = new Set(["updatedAt"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectConfigChanges(
  changes: RuntimeConfigChange[],
  path: string,
  previous: unknown,
  next: unknown,
): void {
  if (isRecord(previous) && isRecord(next)) {
    const keys = new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ]);
    for (const key of [...keys].sort()) {
      collectConfigChanges(
        changes,
        path ? `${path}.${key}` : key,
        previous[key],
        next[key],
      );
    }
    return;
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    const length = Math.max(previous.length, next.length);
    for (let index = 0; index < length; index += 1) {
      collectConfigChanges(
        changes,
        `${path}.${index}`,
        previous[index],
        next[index],
      );
    }
    return;
  }

  if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) {
    return;
  }
  const leaf = path.split(".").pop() ?? path;
  if (VOLATILE_CONFIG_KEYS.has(leaf)) {
    return;
  }
  changes.push({ path, previous, next });
}

/**
 * Flattens the difference between two effective configs into leaf changes.
 * Objects and arrays recurse so each change points at the exact value path;
 * missing keys or indexes appear as added or removed.
 */
function diffConfig(
  previous: RuntimeConfig,
  next: RuntimeConfig,
): RuntimeConfigChange[] {
  const changes: RuntimeConfigChange[] = [];
  collectConfigChanges(changes, "", previous, next);
  return changes;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return fs.readJSON(filePath).catch(() => undefined);
}

function uniqueSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) =>
          String(symbol || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function deriveMode(runtime: RuntimeControlConfig): RuntimeMode {
  return runtime.sandboxEnabled === true ? "sandbox" : "live";
}

/**
 * Loads the catalog, migrating only the renamed per-account entry threshold.
 * Throws when either file is missing or malformed.
 */
async function load(): Promise<RuntimeStorageCatalog> {
  const [configRaw, accountsRaw] = await Promise.all([
    readJsonFile(storageFiles.prod.config),
    readJsonFile(storageFiles.prod.accounts),
  ]);

  if (
    !isRecord(configRaw) ||
    !isRecord(configRaw.management) ||
    !isRecord(configRaw.runtime)
  ) {
    throw new Error(
      `Runtime storage config is missing or invalid at ${storageFiles.prod.config}.`,
    );
  }

  const accounts =
    isRecord(accountsRaw) && Array.isArray(accountsRaw.accounts)
      ? accountsRaw.accounts
      : null;
  if (!accounts || !accounts.every(isRecord)) {
    throw new Error(
      `Runtime storage accounts are missing or invalid at ${storageFiles.prod.accounts}.`,
    );
  }

  const config = {
    management: configRaw.management,
    runtime: configRaw.runtime,
    accounts: accounts.map((account) => ({
      ...account,
      trading: runtimeAccounts.trading.migrate(account.trading),
    })),
  } as unknown as RuntimeConfig;

  return { config, mode: deriveMode(config.runtime) };
}

/** Atomically persists the shared config file. */
async function saveConfig(config: RuntimeConfig): Promise<void> {
  await jsonFile.write.atomic(storageFiles.prod.config, {
    management: config.management,
    runtime: config.runtime,
  });
}

/** Atomically persists the accounts file, reserving removed slugs forever. */
async function saveAccounts(
  accounts: unknown,
): Promise<RuntimeAccountConfig[]> {
  const previous = await readJsonFile(storageFiles.prod.accounts);
  const previousRecord = isRecord(previous) ? previous : {};
  const previousAccounts = Array.isArray(previousRecord.accounts)
    ? previousRecord.accounts
    : [];
  const requestedSlugs = new Set(
    (Array.isArray(accounts) ? accounts : [])
      .map((item) =>
        item && typeof item === "object"
          ? runtimeAccounts.slug.normalize(
              (item as { slug?: unknown; id?: unknown }).slug ??
                (item as { id?: unknown }).id,
            )
          : "",
      )
      .filter(Boolean),
  );
  const retiredSlugs = new Set(
    (Array.isArray(previousRecord.retiredSlugs)
      ? previousRecord.retiredSlugs
      : []
    ).map(runtimeAccounts.slug.normalize),
  );

  for (const account of previousAccounts) {
    const slug = runtimeAccounts.slug.normalize(
      (account as { slug?: unknown; id?: unknown }).slug ??
        (account as { id?: unknown }).id,
    );
    if (slug && !requestedSlugs.has(slug)) retiredSlugs.add(slug);
  }

  const normalized = runtimeAccounts.normalize({
    accounts,
    retiredSlugs: [...retiredSlugs],
  });
  const payload: RuntimeAccountsFileData = {
    accounts: normalized,
    retiredSlugs: [...retiredSlugs].sort(),
    updatedAt: Date.now(),
  };
  await jsonFile.write.atomic(storageFiles.prod.accounts, payload);
  return normalized;
}

/** Loads normalized account profiles from the accounts file. */
async function listAccounts(): Promise<RuntimeAccountConfig[]> {
  const raw = await readJsonFile(storageFiles.prod.accounts);
  const record = isRecord(raw) ? raw : {};
  const accounts = runtimeAccounts.normalize({
    accounts: record.accounts,
    retiredSlugs: record.retiredSlugs,
  });

  if (!Array.isArray(record.accounts)) {
    await saveAccounts(accounts);
  }
  return accounts;
}

/** Atomically persists the whole catalog (config + accounts). */
async function save(config: RuntimeConfig): Promise<void> {
  await saveConfig(config);
  await jsonFile.write.atomic(storageFiles.prod.accounts, {
    accounts: config.accounts,
    updatedAt: Date.now(),
  } satisfies RuntimeAccountsFileData);
}

/**
 * Seeds the default catalog when neither file exists yet. Throws on a partial
 * catalog — a missing half is a corruption signal, not a first boot.
 */
async function ensure(): Promise<RuntimeStorageCatalog> {
  const [configRaw, accountsRaw] = await Promise.all([
    fs.pathExists(storageFiles.prod.config),
    fs.pathExists(storageFiles.prod.accounts),
  ]);

  if (!configRaw && !accountsRaw) {
    const config = runtimeDefaults.config.create(
      runtimeAccounts.createDefault(),
    );
    await save(config);
  }

  return load();
}

/** Deletes every persisted file owned by one account. Shared rows survive. */
async function deleteAccountState(accountSlug: string): Promise<void> {
  const slug = runtimeAccounts.slug.normalize(accountSlug);
  if (slug) {
    await fs.remove(storageFiles.prod.accountRoot(slug));
  }
}

/**
 * Resets one account's sandbox mode state, optionally updating its configured
 * sandbox starting balance. History files are shared per mode, so the
 * account's sandbox rows are stripped from each symbol file.
 */
async function resetAccountSandbox(params: {
  account: string;
  initialBalanceUSDT?: number;
}): Promise<void> {
  const slug = runtimeAccounts.slug.normalize(params.account);
  if (!slug) {
    throw new Error("A valid account is required to reset sandbox state.");
  }

  const catalog = await load();
  const account = catalog.config.accounts.find(
    (candidate) => candidate.slug === slug,
  );
  if (!account) {
    throw new Error(`Unknown exchange account: ${slug}`);
  }

  const initialBalanceUSDT =
    typeof params.initialBalanceUSDT === "number"
      ? Math.max(0, params.initialBalanceUSDT)
      : account.sandbox.initialBalanceUSDT;

  if (typeof params.initialBalanceUSDT === "number") {
    const nextAccount: RuntimeAccountConfig = {
      ...account,
      sandbox: { initialBalanceUSDT },
      updatedAt: Date.now(),
    };
    const accounts = catalog.config.accounts.map((candidate) =>
      candidate.slug === slug ? nextAccount : candidate,
    );
    await save({ ...catalog.config, accounts });
  }

  const files = storageFiles.prod.account(slug, "sandbox");
  await Promise.all([
    jsonFile.write.atomic(files.positions, []),
    jsonFile.write.atomic(files.balance, {
      startingBalanceUSDT: initialBalanceUSDT,
      quoteAsset: initialBalanceUSDT,
    }),
  ]);
  await clearAccountHistory("sandbox", slug);
}

/** Removes one account's rows from every shared history file of a mode. */
async function clearAccountHistory(
  mode: RuntimeMode,
  accountSlug: string,
): Promise<number> {
  const symbols = await fs
    .readdir(storageFiles.prod.history(mode), { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);

  let removed = 0;
  for (const entry of symbols) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const symbol = entry.name.slice(0, -".json".length);
    await jsonFile.update.atomic<unknown[]>(
      storageFiles.prod.historyFile(mode, symbol),
      (raw) => {
        const current = Array.isArray(raw) ? raw : [];
        const next = current.filter(
          (position) =>
            !(
              position &&
              typeof position === "object" &&
              "account" in position &&
              position.account === accountSlug
            ),
        );
        removed += current.length - next.length;
        return next;
      },
    );
  }

  return removed;
}

/**
 * Applies a partial config/runtime update and persists the resulting catalog.
 * Flat `config` fields split into shared management keys and the target
 * account's trading overrides.
 */
async function update(
  input: RuntimeCatalogUpdateInput,
): Promise<RuntimeStorageCatalog> {
  const catalog = await load();
  const config: RuntimeConfig = structuredClone(catalog.config);
  const requestedSlug = runtimeAccounts.slug.normalize(input.account);
  const targetIndex = requestedSlug
    ? config.accounts.findIndex(
        (account) => account.slug === requestedSlug,
      )
    : 0;
  const resolvedIndex = targetIndex >= 0 ? targetIndex : 0;
  let target = config.accounts[resolvedIndex];
  if (!target) {
    throw new Error("Cannot update runtime config without accounts.");
  }

  // A. Apply flat strategy-config updates: merge over the effective config,
  //    then split back into shared management + account trading fields.
  if (input.config) {
    const effective = runtimeAccountConfig.effective(
      config.management,
      target,
    );
    const merged = {
      ...effective,
      ...input.config,
      maxOpenPositions: runtimeNormalize.values.maxOpenPositions(
        input.config.maxOpenPositions ?? effective.maxOpenPositions,
      ),
      blackSwan: blackSwan.config.normalize(
        input.config.blackSwan ?? effective.blackSwan,
      ),
    };
    config.management = runtimeAccountConfig.shared.fromEffective(
      config.management,
      merged,
    );
    target = runtimeAccountConfig.trading.withEffective(target, merged);
  }

  // B. Apply top-level update fields kept for API compatibility.
  if (input.exchangeType) {
    config.management.exchangeType = input.exchangeType;
  }
  if (input.symbols) {
    config.management.symbols = uniqueSymbols(input.symbols);
  }

  const runtime = config.runtime;
  if (typeof input.sandboxEnabled === "boolean") {
    runtime.sandboxEnabled = input.sandboxEnabled;
  }
  if (typeof input.runnerEnabled === "boolean") {
    runtime.runnerEnabled = input.runnerEnabled;
  }
  if (typeof input.autoEntryEnabled === "boolean") {
    runtime.autoEntryEnabled = input.autoEntryEnabled;
  }
  if (input.autoEntryDailyPnlLimitUSDT !== undefined) {
    runtime.autoEntryDailyPnlLimitUSDT =
      runtimeNormalize.values.dailyPnlThresholdUsdt(
        input.autoEntryDailyPnlLimitUSDT,
      );
  }
  if (typeof input.autoExitEnabled === "boolean") {
    runtime.autoExitEnabled = input.autoExitEnabled;
  }
  if (typeof input.entrySignalBypass === "boolean") {
    runtime.entrySignalBypass = input.entrySignalBypass;
  }
  if (typeof input.autoRemoveSymbolAbsLevel === "number") {
    runtime.autoRemoveSymbolAbsLevel =
      runtimeNormalize.values.autoRemoveAbsLevel(
        input.autoRemoveSymbolAbsLevel,
      );
  }
  if (typeof input.autoRemoveSymbolMinPrice === "number") {
    runtime.autoRemoveSymbolMinPrice =
      runtimeNormalize.values.autoRemoveFloor(input.autoRemoveSymbolMinPrice);
  }
  if (typeof input.autoRemoveSymbolMinMarketCapUSD === "number") {
    runtime.autoRemoveSymbolMinMarketCapUSD =
      runtimeNormalize.values.autoRemoveFloor(
        input.autoRemoveSymbolMinMarketCapUSD,
      );
  }
  if (typeof input.autoRemoveSymbolMinVPointPct === "number") {
    runtime.autoRemoveSymbolMinVPointPct =
      runtimeNormalize.values.autoRemoveVPointPct(
        input.autoRemoveSymbolMinVPointPct,
      );
  }
  if (input.pnlHistoryBucketMinutes !== undefined) {
    runtime.pnlHistoryBucketMinutes =
      reporting.history.bucket.normalizeMinutes(
        input.pnlHistoryBucketMinutes,
      );
  }
  if (input.speedupStageIntervalMinutes !== undefined) {
    runtime.speedupStageIntervalMinutes =
      runtimeStages.interval.normalizeMinutes(
        input.speedupStageIntervalMinutes,
        runtimeStages.interval.defaults.speedup,
      );
  }
  if (input.blackSwanStageIntervalMinutes !== undefined) {
    runtime.blackSwanStageIntervalMinutes =
      runtimeStages.interval.normalizeMinutes(
        input.blackSwanStageIntervalMinutes,
        runtimeStages.interval.defaults["risk-sentinel"],
      );
  }
  if (input.speedupStagePositivePnlThresholdPct !== undefined) {
    runtime.speedupStagePositivePnlThresholdPct =
      runtimeStages.speedupThreshold.normalizePct(
        input.speedupStagePositivePnlThresholdPct,
        runtimeStages.speedupThreshold.defaults.positivePct,
      );
  }
  if (input.speedupStageNegativePnlThresholdPct !== undefined) {
    runtime.speedupStageNegativePnlThresholdPct =
      runtimeStages.speedupThreshold.normalizePct(
        input.speedupStageNegativePnlThresholdPct,
        runtimeStages.speedupThreshold.defaults.negativePct,
      );
  }
  if (input.speedupStageTakeProfitOffsetPct !== undefined) {
    runtime.speedupStageTakeProfitOffsetPct =
      runtimeStages.speedupThreshold.normalizePct(
        input.speedupStageTakeProfitOffsetPct,
        runtimeStages.speedupThreshold.defaults.takeProfitOffsetPct,
      );
  }
  if (input.standardMonitoringStageIntervalMinutes !== undefined) {
    runtime.standardMonitoringStageIntervalMinutes =
      runtimeStages.interval.normalizeMinutes(
        input.standardMonitoringStageIntervalMinutes,
        runtimeStages.interval.defaults["standard-monitoring"],
      );
  }
  if (input.managementStageIntervalMinutes !== undefined) {
    runtime.managementStageIntervalMinutes =
      runtimeStages.interval.normalizeMinutes(
        input.managementStageIntervalMinutes,
        runtimeStages.interval.defaults.management,
      );
  }
  if (input.captureEntryStageIntervalMinutes !== undefined) {
    runtime.captureEntryStageIntervalMinutes =
      runtimeStages.interval.normalizeMinutes(
        input.captureEntryStageIntervalMinutes,
        runtimeStages.interval.defaults["capture-entry"],
      );
  }
  if (input.notification !== undefined) {
    runtime.notification = normalizeDashboardNotificationConfig(
      input.notification,
      "SLOW",
    );
  }

  target = { ...target, updatedAt: Date.now() };
  config.accounts = config.accounts.map((account) =>
    account.slug === target!.slug ? target! : account,
  );

  if (input.withdrawal !== undefined) {
    runtime.withdrawal = runtimeNormalize.withdrawal.normalizeConfig({
      ...runtime.withdrawal,
      ...input.withdrawal,
    });
  }
  if (input.safeHaven !== undefined) {
    runtime.safeHaven = runtimeNormalize.safeHaven.normalizeConfig({
      ...runtime.safeHaven,
      ...input.safeHaven,
    });
  }
  if (input.mcp !== undefined) {
    runtime.mcp = runtimeNormalize.mcp.normalizeConfig({
      ...runtime.mcp,
      ...input.mcp,
    });
  }

  await save(config);

  // C. Direct Safe Haven balance update on the target account's active mode.
  if (typeof input.safeHavenUSDT === "number") {
    const mode = deriveMode(runtime);
    const files = storageFiles.prod.account(target.slug, mode);
    const rawBalance = await readJsonFile(files.balance);
    const balance = (isRecord(rawBalance)
      ? rawBalance
      : {}) as RuntimeAccountModeState["balance"];
    const previousUSDT = Number(balance.safeHaven) || 0;
    const nextUSDT = Math.max(0, input.safeHavenUSDT);

    if (Math.abs(previousUSDT - nextUSDT) > 1e-9) {
      balance.safeHaven = nextUSDT;
      await jsonFile.write.atomic(files.balance, balance);
      // PROD:SAFE_HAVEN_LOG
      await runtimeLogs.appendSafeHaven({
        account: target.slug,
        mode,
        previousUSDT,
        nextUSDT,
        source: input.safeHavenLogSource ?? "manual_update",
        reason: input.safeHavenLogReason,
      });
    }
  }

  return { config, mode: deriveMode(config.runtime) };
}

/** Grouped catalog operations over the persistent layout. */
const runtimeCatalog = {
  load,
  ensure,
  save,
  update,
  diffConfig,
  accounts: {
    list: listAccounts,
    save: saveAccounts,
  },
  account: {
    deleteState: deleteAccountState,
    resetSandbox: resetAccountSandbox,
  },
} as const;

export default runtimeCatalog;
export { runtimeCatalog };
