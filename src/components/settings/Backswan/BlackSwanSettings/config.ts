import type { ChipProps } from "@mui/material";
import type { BlackSwanConfig, BlackSwanStatus } from "@/lib/system/trading/black-swan";

export const STATUS_STEPS = [
  {
    status: "NORMAL",
    color: "success",
    description: "Normal entries, exits, and averaging continue.",
  },
  {
    status: "WATCH",
    color: "warning",
    description: "New entries and averaging pause while BTC is under warning.",
  },
  {
    status: "CRISIS",
    color: "error",
    description: "The selected emergency policy is applied to open positions.",
  },
  {
    status: "RECOVERY",
    color: "secondary",
    description:
      "Risk stays paused until cooldown and acknowledgement complete.",
  },
] as const;

export const EXIT_POLICY_DETAILS: Record<
  BlackSwanConfig["exitPolicy"],
  { severity: "info" | "warning" | "error"; text: string }
> = {
  FREEZE_ONLY: {
    severity: "info",
    text: "Pauses entries and averaging, but leaves every open position to its existing exit rules.",
  },
  CLOSE_ADVERSE: {
    severity: "warning",
    text: "Recommended for downward-crash protection: closes LONG futures and managed spot positions while preserving SHORT hedges.",
  },
  FLATTEN_ALL: {
    severity: "error",
    text: "Closes every managed open position, including profitable SHORT hedges. Use only when you want maximum exposure reduction.",
  },
};

export function statusColor(status: BlackSwanStatus): ChipProps["color"] {
  if (status === "NORMAL") return "success";
  if (status === "WATCH") return "warning";
  if (status === "CRISIS") return "error";
  return "secondary";
}
