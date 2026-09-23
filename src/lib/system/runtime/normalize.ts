import { DEFAULT_EXCHANGE_ACCOUNT_SLUG } from "@/lib/exchange/types";
import {
  DEFAULT_AUTO_ENTRY_DAILY_PNL_LIMIT_USDT,
  DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT,
} from "./defaults";
import type {
  RuntimeMcpConfig,
  RuntimeMcpPermission,
  RuntimeMcpTokenRecord,
  RuntimeMode,
  RuntimeSafeHavenConfig,
  RuntimeSafeHavenSchedule,
  RuntimeWithdrawalConfig,
  RuntimeWithdrawalSchedule,
  RuntimeWithdrawalWallet,
  RuntimeConfig,
  RuntimeSettingsConfig,
} from "./types";

const RUNTIME_MCP_PERMISSIONS: RuntimeMcpPermission[] = [
  "tags.read",
  "tags.write",
  "coin_metadata.read",
  "coin_metadata.write",
  "coin_metadata.broadcast",
  "balance.read",
  "trade_history.read",
  "monitoring.read",
];
const MCP_PERMISSION_SET = new Set<string>(RUNTIME_MCP_PERMISSIONS);

function normalizeId(value: unknown, fallback: string): string {
  const id = String(value ?? "").trim();
  return id || fallback;
}

/** Normalizes the auto-removal absolute-level threshold. */
function normalizeAutoRemoveAbsLevel(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/** Normalizes a non-negative auto-removal floor (price or market cap). */
function normalizeAutoRemoveFloor(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

/** Normalizes the stored-vPoint percent threshold used by coin auto-removal. */
function normalizeAutoRemoveVPointPct(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT;
  }

  return Math.max(0, parsed);
}

/** Normalizes the portfolio-wide open-position entry limit. */
function normalizeMaxOpenPositions(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/** Normalizes the automatic-entry daily PnL stop as a non-positive USDT value. */
function normalizeDailyPnlThresholdUsdt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(0, parsed)
    : DEFAULT_AUTO_ENTRY_DAILY_PNL_LIMIT_USDT;
}

/** Normalizes a UTC day-of-month to the 1–31 range. */
function normalizeDayOfMonth(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.min(31, Math.max(1, normalized));
}

/** Normalizes one persisted withdrawal wallet-book entry. */
function normalizeWithdrawalWallet(
  value: unknown,
  index: number,
): RuntimeWithdrawalWallet | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<RuntimeWithdrawalWallet>;
  const name = String(raw.name ?? "").trim();
  const network = String(raw.network ?? "")
    .trim()
    .toUpperCase();
  const address = String(raw.address ?? "").trim();

  if (!name && !network && !address) {
    return null;
  }

  return {
    id: normalizeId(raw.id, `wallet-${index + 1}`),
    name: name || `Wallet ${index + 1}`,
    network,
    address,
  };
}

/** Normalizes one persisted withdrawal schedule. */
function normalizeWithdrawalSchedule(
  value: unknown,
  index: number,
): RuntimeWithdrawalSchedule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<RuntimeWithdrawalSchedule> & {
    intervalDays?: unknown;
  };
  const lastAttemptAt = Number(raw.lastAttemptAt);
  const lastSuccessAt = Number(raw.lastSuccessAt);
  const lastQueuedAt = Number(raw.lastQueuedAt);

  return {
    id: normalizeId(raw.id, `schedule-${index + 1}`),
    account: String(raw.account ?? "").trim() || DEFAULT_EXCHANGE_ACCOUNT_SLUG,
    name: String(raw.name ?? "").trim() || `Schedule ${index + 1}`,
    enabled: raw.enabled !== false,
    amountUSDT: Math.max(0, Number(raw.amountUSDT) || 0),
    dayOfMonth: normalizeDayOfMonth(raw.dayOfMonth ?? raw.intervalDays),
    ...(String(raw.walletId ?? "").trim()
      ? { walletId: String(raw.walletId).trim() }
      : {}),
    targetNetwork: String(raw.targetNetwork ?? "")
      .trim()
      .toUpperCase(),
    targetWalletAddress: String(raw.targetWalletAddress ?? "").trim(),
    ...(Number.isFinite(lastAttemptAt) && lastAttemptAt > 0
      ? { lastAttemptAt }
      : {}),
    ...(Number.isFinite(lastSuccessAt) && lastSuccessAt > 0
      ? { lastSuccessAt }
      : {}),
    ...(Number.isFinite(lastQueuedAt) && lastQueuedAt > 0
      ? { lastQueuedAt }
      : {}),
    ...(typeof raw.lastStatus === "string" && raw.lastStatus.trim()
      ? { lastStatus: raw.lastStatus.trim() }
      : {}),
  };
}

/** Normalizes persisted withdrawal runtime settings. */
function normalizeWithdrawalConfig(value: unknown): RuntimeWithdrawalConfig {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<RuntimeWithdrawalConfig> & {
          amountUSDT?: unknown;
          dayOfMonth?: unknown;
          intervalDays?: unknown;
          targetNetwork?: unknown;
          targetWalletAddress?: unknown;
          lastAttemptAt?: unknown;
          lastSuccessAt?: unknown;
          lastStatus?: unknown;
        })
      : {};
  const walletBook = Array.isArray(raw.walletBook)
    ? raw.walletBook
        .map((wallet, index) => normalizeWithdrawalWallet(wallet, index))
        .filter((wallet): wallet is RuntimeWithdrawalWallet =>
          Boolean(wallet),
        )
    : [];
  const schedulesRaw = Array.isArray(raw.schedules) ? raw.schedules : [];
  const legacySchedule =
    !Array.isArray(raw.schedules) &&
    ((Number(raw.amountUSDT) || 0) > 0 ||
      String(raw.targetNetwork ?? "").trim() ||
      String(raw.targetWalletAddress ?? "").trim())
      ? [
          {
            id: "legacy-withdrawal",
            name: "Default Withdrawal",
            enabled: true,
            amountUSDT: raw.amountUSDT,
            dayOfMonth: raw.dayOfMonth ?? raw.intervalDays,
            targetNetwork: raw.targetNetwork,
            targetWalletAddress: raw.targetWalletAddress,
            lastAttemptAt: raw.lastAttemptAt,
            lastSuccessAt: raw.lastSuccessAt,
            lastStatus: raw.lastStatus,
          },
        ]
      : [];
  const schedules = [...schedulesRaw, ...legacySchedule]
    .map((schedule, index) => normalizeWithdrawalSchedule(schedule, index))
    .filter((schedule): schedule is RuntimeWithdrawalSchedule =>
      Boolean(schedule),
    );

  return {
    autoEnabled: Boolean(raw.autoEnabled),
    schedules,
    walletBook,
  };
}

function normalizeLastQueuedAt(
  value: unknown,
): Partial<Record<RuntimeMode, number>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<Record<RuntimeMode, unknown>>;
  const live = Number(raw.live);
  const sandbox = Number(raw.sandbox);
  const result = {
    ...(Number.isFinite(live) && live > 0 ? { live } : {}),
    ...(Number.isFinite(sandbox) && sandbox > 0 ? { sandbox } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Normalizes one persisted Safe Haven schedule. */
function normalizeSafeHavenSchedule(
  value: unknown,
  index: number,
): RuntimeSafeHavenSchedule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<RuntimeSafeHavenSchedule>;
  const lastQueuedAt = normalizeLastQueuedAt(raw.lastQueuedAt);
  return {
    id: String(raw.id ?? "").trim() || `safe-haven-${index + 1}`,
    name: String(raw.name ?? "").trim() || `Safe Haven ${index + 1}`,
    enabled: raw.enabled !== false,
    amountUSDT: Math.max(0, Number(raw.amountUSDT) || 0),
    pct: Math.min(100, Math.max(0, Number(raw.pct) || 0)),
    dayOfMonth: normalizeDayOfMonth(raw.dayOfMonth),
    ...(lastQueuedAt ? { lastQueuedAt } : {}),
  };
}

/** Normalizes persisted Safe Haven runtime settings. */
function normalizeSafeHavenConfig(value: unknown): RuntimeSafeHavenConfig {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<RuntimeSafeHavenConfig>)
      : {};
  const schedules = Array.isArray(raw.schedules) ? raw.schedules : [];

  return {
    autoEnabled: Boolean(raw.autoEnabled),
    schedules: schedules
      .map((schedule, index) => normalizeSafeHavenSchedule(schedule, index))
      .filter((schedule): schedule is RuntimeSafeHavenSchedule =>
        Boolean(schedule),
      ),
  };
}

function normalizeMcpTimestamp(value: unknown): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function normalizeMcpPermissions(value: unknown): RuntimeMcpPermission[] {
  if (!Array.isArray(value)) return [];
  const permissions = value
    .map((permission) => String(permission))
    .filter((permission): permission is RuntimeMcpPermission =>
      MCP_PERMISSION_SET.has(permission),
    );
  return Array.from(new Set(permissions));
}

function normalizeMcpTokenRecord(
  value: unknown,
): RuntimeMcpTokenRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RuntimeMcpTokenRecord>;
  const id = String(record.id ?? "").trim();
  const tokenHash = String(record.tokenHash ?? "").trim();
  const tokenSecretEncrypted = String(record.tokenSecretEncrypted ?? "").trim();
  if (
    !id ||
    !/^[a-f0-9]{64}$/i.test(tokenHash) ||
    !tokenSecretEncrypted.startsWith("v1:")
  ) {
    return null;
  }

  return {
    id,
    name: String(record.name ?? "MCP token").trim().slice(0, 80) || "MCP token",
    enabled: record.enabled === true,
    permissions: normalizeMcpPermissions(record.permissions),
    tokenHash,
    tokenSecretEncrypted,
    createdAt: normalizeMcpTimestamp(record.createdAt),
    lastUsedAt:
      typeof record.lastUsedAt === "number" &&
      Number.isFinite(record.lastUsedAt)
        ? record.lastUsedAt
        : undefined,
  };
}

/** Normalizes persisted MCP settings and drops invalid token rows. */
function normalizeMcpConfig(value: unknown): RuntimeMcpConfig {
  if (!value || typeof value !== "object") return { tokens: [] };
  const raw = value as Partial<RuntimeMcpConfig>;
  const tokens = Array.isArray(raw.tokens)
    ? raw.tokens
        .map((token) => normalizeMcpTokenRecord(token))
        .filter((token): token is RuntimeMcpTokenRecord => Boolean(token))
    : [];

  return { tokens };
}

/** Grouped runtime-config normalizers used by the catalog update path. */
const runtimeNormalize = {
  config: { toRuntime: toRuntimeConfig },
  values: {
    autoRemoveAbsLevel: normalizeAutoRemoveAbsLevel,
    autoRemoveFloor: normalizeAutoRemoveFloor,
    autoRemoveVPointPct: normalizeAutoRemoveVPointPct,
    dailyPnlThresholdUsdt: normalizeDailyPnlThresholdUsdt,
    dayOfMonth: normalizeDayOfMonth,
    maxOpenPositions: normalizeMaxOpenPositions,
  },
  withdrawal: { normalizeConfig: normalizeWithdrawalConfig },
  safeHaven: { normalizeConfig: normalizeSafeHavenConfig },
  mcp: {
    normalizeConfig: normalizeMcpConfig,
    permissions: RUNTIME_MCP_PERMISSIONS,
  },
} as const;

export default runtimeNormalize;
export { runtimeNormalize };

/** Converts the dashboard settings payload into the engine's canonical config. */
function toRuntimeConfig(settings: RuntimeSettingsConfig): RuntimeConfig {
  const { mcp: _mcp, ...runtime } = settings.runtime;
  return {
    management: settings.management,
    accounts: settings.accounts,
    runtime: { ...runtime, mcp: { tokens: [] } },
  };
}
