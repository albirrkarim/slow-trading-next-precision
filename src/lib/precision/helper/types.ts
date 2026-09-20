import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import type { SlowTradingAccount } from "@/lib/slowTrading";

export type RuntimeMarketInterval = "1m" | "5m";

export interface RuntimeMarketHelper {
  updateMarkPrice(interval?: RuntimeMarketInterval): Promise<void>;
  updateVPointsMap(interval?: RuntimeMarketInterval): Promise<void>;
}

export interface RuntimeHelper {
  getAccount(accountSlug: string): SlowTradingAccount;
  getAccountBalance(accountSlug: string): BalanceSummary;
  getAccountConfig(
    accountSlug: string,
  ): SlowTradingAccount["trading"];
  market: RuntimeMarketHelper;
}
