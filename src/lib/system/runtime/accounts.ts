import type { RuntimeAccountConfig } from "./types";
import runtimeDefaults, {
  DEFAULT_SANDBOX_INITIAL_BALANCE_USDT,
} from "./defaults";

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Converts a user-facing account name into its stable slug representation. */
function normalizeSlug(value: unknown): string {
  return getString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Allocates a unique immutable slug without reusing deleted account slugs. */
function createUniqueSlug(params: {
  name: unknown;
  reservedSlugs: Iterable<string>;
}): string {
  // PROD:MULTI_ACCOUNT_IMMUTABLE_SLUG
  const reserved = new Set(
    Array.from(params.reservedSlugs, normalizeSlug).filter(Boolean),
  );
  const base = normalizeSlug(params.name) || "account";
  let slug = base;
  let suffix = 2;

  while (reserved.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function normalizeCredentials(
  credentials: unknown,
): RuntimeAccountConfig["credentials"] {
  const record =
    credentials && typeof credentials === "object"
      ? (credentials as Record<string, unknown>)
      : {};

  return {
    apiKey: getString(record.apiKey),
    apiSecret: getString(record.apiSecret),
    ...(getString(record.passphrase)
      ? { passphrase: getString(record.passphrase) }
      : {}),
  };
}

/** Renames the persisted entry minimum without changing its configured value. */
function migrateTradingConfig(value: unknown): RuntimeAccountConfig["trading"] {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const { minActionableAbsoluteLevel, ...trading } = record;
  return {
    ...trading,
    ...(trading.minEntryAbsLevel === undefined &&
    typeof minActionableAbsoluteLevel === "number"
      ? { minEntryAbsLevel: minActionableAbsoluteLevel }
      : {}),
  } as RuntimeAccountConfig["trading"];
}

/** Normalizes one account profile into the canonical persisted shape. */
function createAccount(params: {
  credentials?: unknown;
  createdAt?: number;
  description?: unknown;
  enabled?: unknown;
  name: unknown;
  sandbox?: unknown;
  slug: string;
  trading?: unknown;
  updatedAt?: number;
}): RuntimeAccountConfig {
  const now = Date.now();
  const sandbox =
    params.sandbox && typeof params.sandbox === "object"
      ? (params.sandbox as Record<string, unknown>)
      : {};
  const trading =
    params.trading && typeof params.trading === "object"
      ? migrateTradingConfig(params.trading)
      : runtimeDefaults.trading.create();
  const tradingNotes =
    trading && typeof trading === "object" && "notes" in trading
      ? getString(trading.notes)
      : "";

  return {
    slug: normalizeSlug(params.slug),
    type: "binance",
    name: getString(params.name) || "Binance Account",
    description: getString(params.description),
    credentials: normalizeCredentials(params.credentials),
    enabled: params.enabled !== false,
    trading: { ...trading, notes: tradingNotes },
    sandbox: {
      initialBalanceUSDT: Math.max(
        0,
        Number(
          sandbox.initialBalanceUSDT ?? DEFAULT_SANDBOX_INITIAL_BALANCE_USDT,
        ) || 0,
      ),
    },
    createdAt: typeof params.createdAt === "number" ? params.createdAt : now,
    updatedAt: typeof params.updatedAt === "number" ? params.updatedAt : now,
  };
}

/** Creates the initial Binance account profiles from environment credentials. */
function createDefaultAccounts(): RuntimeAccountConfig[] {
  const now = Date.now();
  const credentials = [
    {
      apiKey: process.env.BINANCE_1_API_KEY ?? process.env.BINANCE_API_KEY ?? "",
      apiSecret:
        process.env.BINANCE_1_API_SECRET ??
        process.env.BINANCE_1_SECRET_KEY ??
        process.env.BINANCE_SECRET_KEY ??
        process.env.BINANCE_API_SECRET ??
        "",
    },
    {
      apiKey: process.env.BINANCE_2_API_KEY ?? "",
      apiSecret:
        process.env.BINANCE_2_API_SECRET ??
        process.env.BINANCE_2_SECRET_KEY ??
        "",
    },
  ];

  return credentials
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => index === 0 || item.apiKey || item.apiSecret)
    .map(({ item, index }) =>
      createAccount({
        slug: `binance-${index + 1}`,
        name: `Binance ${index + 1}`,
        credentials: item,
        createdAt: now,
        updatedAt: now,
      }),
    );
}

/** Normalizes account profiles while preserving stable unique slugs. */
function normalizeAccounts(params: {
  accounts: unknown;
  retiredSlugs?: unknown;
}): RuntimeAccountConfig[] {
  const items = Array.isArray(params.accounts) ? params.accounts : [];
  const reserved = new Set(
    (Array.isArray(params.retiredSlugs) ? params.retiredSlugs : [])
      .map(normalizeSlug)
      .filter(Boolean),
  );
  const accounts: RuntimeAccountConfig[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<RuntimeAccountConfig> & { id?: unknown };
    const requestedSlug = normalizeSlug(record.slug ?? record.id);
    const slug =
      requestedSlug && !reserved.has(requestedSlug)
        ? requestedSlug
        : createUniqueSlug({
            name: record.name,
            reservedSlugs: reserved,
          });
    reserved.add(slug);
    accounts.push(
      createAccount({
        slug,
        name: record.name,
        description: record.description,
        credentials: record.credentials,
        enabled: record.enabled,
        trading: record.trading,
        sandbox: record.sandbox,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    );
  }

  return accounts.length > 0 ? accounts : createDefaultAccounts();
}

/** Grouped account profile helpers shared by storage and the settings API. */
const runtimeAccounts = {
  create: createAccount,
  createDefault: createDefaultAccounts,
  normalize: normalizeAccounts,
  trading: { migrate: migrateTradingConfig },
  slug: {
    normalize: normalizeSlug,
    createUnique: createUniqueSlug,
  },
} as const;

export default runtimeAccounts;
export { runtimeAccounts };
