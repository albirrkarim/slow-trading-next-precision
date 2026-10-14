"use client";

import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Button, ButtonGroup, Typography } from "@mui/material";
import { useEffect } from "react";

import type { TradePlanSide } from "@/lib/system/utils/ui/trade-plan";

/**
 * Toolbar pair that arms placement of a new long or short plan; the next
 * click on the chart drops it. Pressing the armed side again or Esc cancels.
 */
export default function TradePlanButtons({
  disabled,
  placing,
  onPlacingChange,
}: {
  disabled: boolean;
  placing: TradePlanSide | null;
  onPlacingChange: (side: TradePlanSide | null) => void;
}) {
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPlacingChange(null);
    };
    window.addEventListener("keydown", onKey);
    // eslint-disable-next-line consistent-return
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlacingChange, placing]);

  const toggle = (side: TradePlanSide) => onPlacingChange(placing === side ? null : side);

  return (
    <>
      <ButtonGroup disabled={disabled} size="small" sx={{ height: 34 }}>
        <Button
          color="success"
          onClick={() => toggle("LONG")}
          startIcon={<TrendingUpIcon fontSize="small" />}
          sx={{ textTransform: "none" }}
          title="Draw a long plan (visual only)"
          variant={placing === "LONG" ? "contained" : "outlined"}
        >
          Long
        </Button>
        <Button
          color="error"
          onClick={() => toggle("SHORT")}
          startIcon={<TrendingDownIcon fontSize="small" />}
          sx={{ textTransform: "none" }}
          title="Draw a short plan (visual only)"
          variant={placing === "SHORT" ? "contained" : "outlined"}
        >
          Short
        </Button>
      </ButtonGroup>
      {placing && (
        <Typography color="text.secondary" variant="caption">
          Click the chart at the entry price and time · Esc cancels
        </Typography>
      )}
    </>
  );
}
