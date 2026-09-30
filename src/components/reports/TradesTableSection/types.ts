import type { RuntimeAccountConfig } from "@/lib/system/runtime";

export type SortKey =
  | "symbol"
  | "entryTime"
  | "entryMarginUSDT"
  | "exitTime"
  | "holdMs"
  | "maxDrawdownPercent"
  | "maxRunUpPercent"
  | "maxDrawdownUsdt"
  | "maxRunUpUsdt"
  | "netProfitUSDT";

export type TradeHistoryAccount = Pick<RuntimeAccountConfig, "name" | "slug"> & {
  trading?: Pick<RuntimeAccountConfig["trading"], "notes">;
};
