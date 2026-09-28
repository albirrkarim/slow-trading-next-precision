"use client";

import AltRouteIcon from "@mui/icons-material/AltRoute";
import { Chip, Tooltip } from "@mui/material";

const STRATEGY_LABELS: Record<string, string> = {
  both: "Both",
  streak: "Streak",
};

/** Resolves the display label for a `management.strategy` slug. */
export function strategyChipLabel(strategy?: string): string {
  if (!strategy) return "Default";
  return (
    STRATEGY_LABELS[strategy] ??
    strategy.charAt(0).toUpperCase() + strategy.slice(1)
  );
}

export default function NavbarStrategyChip({
  strategy,
}: {
  strategy?: string;
}) {
  const label = strategyChipLabel(strategy);

  return (
    <Tooltip
      arrow
      placement="bottom-start"
      title={`Active strategy (management.strategy): ${label}`}
    >
      <Chip
        aria-label={`Active strategy ${label}`}
        icon={<AltRouteIcon fontSize="small" />}
        label={label}
        size="small"
        variant="outlined"
      />
    </Tooltip>
  );
}
