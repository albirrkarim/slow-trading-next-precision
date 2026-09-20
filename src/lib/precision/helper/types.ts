import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import type { SlowTradingAccount } from "@/lib/slowTrading";

export interface RuntimeHelper {
  getAccount(accountSlug: string): SlowTradingAccount;
  getAccountBalance(accountSlug: string): BalanceSummary;
  getAccountConfig(
    accountSlug: string,
  ): SlowTradingAccount["trading"];
}
