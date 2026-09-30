"use client";

import type { ReactElement } from "react";
import { Tooltip, Typography } from "@mui/material";
import { formatPercent } from "./format";

const tooltipSlotProps = {
  tooltip: {
    sx: {
      maxWidth: 360,
      p: 1,
      fontSize: "0.78rem",
      lineHeight: 1.4,
    },
  },
};

export function MetricTooltip({
  children,
  title,
}: {
  children: ReactElement;
  title: string;
}) {
  return (
    <Tooltip arrow placement="top" slotProps={tooltipSlotProps} title={title}>
      {children}
    </Tooltip>
  );
}

export function DisplayRunUp({ num }: { num?: number }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: "inherit",
      }}
      color={(num ?? 0) >= 0 ? "success.main" : "text.primary"}
    >
      {formatPercent(num)}
    </Typography>
  );
}

export function DisplayDrawdown({ num }: { num?: number }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: "inherit",
      }}
      color={(num ?? 0) < 0 ? "error.main" : "text.primary"}
    >
      {formatPercent(num)}
    </Typography>
  );
}
