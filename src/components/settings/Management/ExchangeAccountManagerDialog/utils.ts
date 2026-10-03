import type { ExchangeAccountType } from "@/lib/exchange/types";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";

export function maskCredentialValue(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function getExchangeAccountTypeLabel(
  type: ExchangeAccountType,
): string {
  return type === "binance" ? "Binance" : type;
}

export const FUTURES_POSITION_MODE_OPTIONS = [
  { label: "One-way", value: "ONE_WAY" },
  { label: "Hedge", value: "HEDGE" },
] satisfies {
  label: string;
  value: NonNullable<RuntimeAccountConfig["futuresPositionMode"]>;
}[];

export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "account";
}
