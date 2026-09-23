import type {
  PositionLevelSequenceItem,
  PositionLevelSequenceState,
} from "./types";

/** Human-readable label for each sequence chip state. */
export const stateLabels: Record<PositionLevelSequenceState, string> = {
  current: "Current",
  exit: "Exit",
  passed: "Passed",
  reserved: "Reserved",
  skipped: "Not averaged",
  target: "Target vPoint hit",
  unreserved: "Unreserved",
};

/** Returns the unsigned level shown on chips (vPoint levels carry a sign). */
export function levelKey(level: number): number {
  return Math.abs(level);
}

/** Checks whether the latest reached level still has no averaging execution. */
export function isReachedWithoutAveraging(
  item: PositionLevelSequenceItem,
  averagingStopped = false,
) {
  return (
    !averagingStopped &&
    item.state === "current" &&
    !item.isEntry &&
    !item.isAveraged
  );
}

/** Formats a finite profit-direction drift percentage, e.g. `+1.25%`. */
export function formatDriftPct(driftPct?: number) {
  if (typeof driftPct !== "number" || !Number.isFinite(driftPct)) {
    return null;
  }

  return `${driftPct > 0 ? "+" : ""}${driftPct.toFixed(2)}%`;
}

/** Formats the actual multiplier persisted for an averaging execution. */
export function formatAveragingMultiplier(multiplier?: number) {
  if (
    typeof multiplier !== "number" ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0
  ) {
    return null;
  }

  return `${Number(multiplier.toFixed(2))}x`;
}

/** Resolves the chip color and variant for a sequence item. */
export function getChipProps(
  item: PositionLevelSequenceItem,
  averagingStopped: boolean,
) {
  switch (item.state) {
    case "current":
      return {
        color: isReachedWithoutAveraging(item, averagingStopped)
          ? ("warning" as const)
          : ("primary" as const),
        variant: "filled" as const,
      };
    case "exit":
      return { color: "info" as const, variant: "filled" as const };
    case "passed":
      return { color: "default" as const, variant: "outlined" as const };
    case "reserved":
      return { color: "success" as const, variant: "outlined" as const };
    case "skipped":
      return { color: "warning" as const, variant: "outlined" as const };
    case "target":
      return { color: "error" as const, variant: "filled" as const };
    default:
      return {
        color:
          item.unreservedCoverage === "full"
            ? ("success" as const)
            : item.unreservedCoverage === "partial"
              ? ("warning" as const)
              : ("default" as const),
        variant: "outlined" as const,
      };
  }
}

/** Formats how much of an unreserved step has spendable coverage. */
export function formatCoverage(
  item: PositionLevelSequenceItem,
): string | null {
  if (
    item.reserveStatus !== "UNRESERVED" ||
    typeof item.marginUsdt !== "number" ||
    !Number.isFinite(item.marginUsdt) ||
    item.marginUsdt < 0
  ) {
    return null;
  }

  const coveragePct =
    item.marginUsdt === 0
      ? 100
      : Math.min(
          100,
          Math.max(0, (item.coveredMarginUsdt / item.marginUsdt) * 100),
        );
  const formattedPct = Number.isInteger(coveragePct)
    ? coveragePct.toFixed(0)
    : coveragePct.toFixed(1);

  return `Coverage ${formattedPct}% ($${item.coveredMarginUsdt.toFixed(2)} of $${item.marginUsdt.toFixed(2)})`;
}

/** Builds the hover explanation for one sequence chip. */
export function buildTooltip(
  item: PositionLevelSequenceItem,
  averagingStopped: boolean,
): string {
  const details = [
    `Level ${levelKey(item.level)}`,
    stateLabels[item.state],
    item.isEntry ? "Entry" : null,
    item.isAveraged ? "Averaged" : null,
    item.isAveraged && formatAveragingMultiplier(item.averagingMultiplier)
      ? `${
          item.adaptiveMultiplier !== undefined
            ? "Adaptive averaging"
            : "Averaging"
        } multiplier ${formatAveragingMultiplier(item.averagingMultiplier)}`
      : null,
    isReachedWithoutAveraging(item, averagingStopped)
      ? "Level reached without averaging"
      : null,
    isReachedWithoutAveraging(item, averagingStopped) &&
    formatDriftPct(item.driftPct)
      ? `Profit-direction drift ${formatDriftPct(item.driftPct)} from the current level vPoint to mark price`
      : null,
    item.state === "skipped" ? "Level was reached without averaging" : null,
    item.state === "target" ? "Remaining averaging steps stopped" : null,
    item.reserveStatus === "RESERVED" ? "Reserved watch step" : null,
    item.reserveStatus === "UNRESERVED" ? "Unreserved watch step" : null,
    formatCoverage(item),
    item.reserveStatus !== "UNRESERVED" && typeof item.marginUsdt === "number"
      ? `Margin $${item.marginUsdt.toFixed(2)}`
      : null,
  ];

  return details.filter(Boolean).join(" | ");
}
