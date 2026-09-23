import type { ExchangeType } from "../types";
import moment from "moment";
import storageRoot from "./root";

/** Persistent mode namespaces owned by the runtime storage layout. */
export type StorageMode = "live" | "sandbox";

const ACCOUNT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// PROD:STORAGE_SOURCE_OF_TRUTH
function prodDir(): string {
  return `${storageRoot.resolve()}/prod`;
}

function devDir(): string {
  return `${storageRoot.resolve()}/dev`;
}

/** Account slugs double as directory names; reject anything that escapes. */
function isValidAccountSlug(slug: string): boolean {
  return ACCOUNT_SLUG_PATTERN.test(slug);
}

function accountDir(slug: string): string {
  if (!isValidAccountSlug(slug)) {
    throw new Error(`Invalid exchange account slug: ${slug}`);
  }

  return `${prodDir()}/accounts/${slug}`;
}

function accountModeFiles(slug: string, mode: StorageMode) {
  const dir = `${accountDir(slug)}/${mode}`;

  return {
    dir,
    positions: `${dir}/positions.json`,
    balance: `${dir}/balance.json`,
    balanceSnapshots: `${dir}/balance_snapshots.json`,
  };
}

const prod = {
  get root() {
    return prodDir();
  },
  get accounts() {
    return `${prodDir()}/accounts.json`;
  },
  get accountsRoot() {
    return `${prodDir()}/accounts`;
  },
  get config() {
    return `${prodDir()}/config.json`;
  },
  get notifications() {
    return `${prodDir()}/notifications.json`;
  },
  get queue() {
    return `${prodDir()}/queue.json`;
  },
  get status() {
    return `${prodDir()}/status.json`;
  },

  accountRoot: accountDir,
  account: accountModeFiles,

  cache: {
    get ip() {
      return `${prodDir()}/cache/ip.json`;
    },
    get marketCap() {
      return `${prodDir()}/cache/marketcap.json`;
    },
    get notificationDedupe() {
      return `${prodDir()}/cache/notification-dedupe.json`;
    },
    ticker24h: (exchangeType: ExchangeType, marketType: string) =>
      `${prodDir()}/cache/ticker-24h-${exchangeType}-${marketType.toLowerCase()}.json`,
    getCachePrefix: (prefix: string) =>
      `${prodDir()}/cache/${prefix}/${moment().format("DD_MMM_YYYY_HH")}_`,
  },

  logs: {
    get binanceCooldowns() {
      return `${prodDir()}/logs/binance_cooldowns.json`;
    },
    get config() {
      return `${prodDir()}/logs/config.json`;
    },
    get errors() {
      return `${prodDir()}/logs/errors.json`;
    },
    get management() {
      return `${prodDir()}/logs/management.json`;
    },
    get safeHaven() {
      return `${prodDir()}/logs/safe_haven.json`;
    },
    get withdrawals() {
      return `${prodDir()}/logs/withdrawals.json`;
    },
  },

  history: (mode: StorageMode) => `${prodDir()}/history/${mode}`,
  historyFile: (mode: StorageMode, symbol: string) =>
    `${prodDir()}/history/${mode}/${symbol}.json`,

  volatility: (exchangeType: string) =>
    `${prodDir()}/volatility/${exchangeType}`,
  volatilityFile: (exchangeType: string, symbol: string) =>
    `${prodDir()}/volatility/${exchangeType}/${symbol}.json`,
};

const dev = {
  get root() {
    return devDir();
  },
  get backtestResults() {
    return `${devDir()}/backtest-results`;
  },
  get leaderboards() {
    return `${devDir()}/leaderboards.json`;
  },
  get precisionTestCaseDir() {
    return `${devDir()}/precision-test-case`;
  },
  get precisionTestCaseActive() {
    return `${devDir()}/precision-test-case.json`;
  },
};

/**
 * Grouped storage path registry for the persistent layout. Paths resolve
 * lazily so the root can change per environment without a module reset.
 */
const storageFiles = {
  get root() {
    return storageRoot.resolve();
  },
  prod,
  dev,
  isValidAccountSlug,
} as const;

export default storageFiles;
