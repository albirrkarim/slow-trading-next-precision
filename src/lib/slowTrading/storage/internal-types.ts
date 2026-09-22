import type { Position } from "@/lib/trading/models";
import type {
  SlowTradingAccount,
  SlowTradingManagementConfig,
  SlowTradingModeState,
  SlowTradingStorageData,
} from "../types";

/** Split config file payload stored under the SLOW storage root. */
export interface SlowTradingConfigFileData {
  /** Shared management configuration persisted once for every account. */
  management: SlowTradingManagementConfig;
  /** Runtime controls persisted in the config split file. */
  runtime: SlowTradingStorageData["runtime"];
  /** Last config-file update timestamp in milliseconds. */
  updatedAt: number;
}

/** Split account file payload stored under the SLOW storage root. */
export interface SlowTradingAccountsFileData {
  /** Saved exchange accounts and private credentials. */
  accounts: SlowTradingAccount[];
  /** Slugs that cannot be reused because history may still reference them. */
  retiredSlugs: string[];
  /** Last account-file update timestamp in milliseconds. */
  updatedAt: number;
}

/** Persisted per-mode memory. Open positions are flat; per-symbol tradeSettings are rebuilt at load. */
export type SlowTradingPersistedModeState = Omit<
  SlowTradingModeState,
  "tradeSettings"
> & {
  positions: Position[];
};

/** Canonical position persisted in one symbol history file. */
export type HistoryPosition = Position;
