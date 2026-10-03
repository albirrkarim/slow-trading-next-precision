"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Box,
  Tooltip,
  Typography,
} from "@mui/material";

const balanceTooltipSlotProps = {
  tooltip: {
    sx: {
      maxWidth: 420,
      p: 1.25,
      fontSize: "0.85rem",
      lineHeight: 1.45,
    },
  },
};

export function BalanceTooltip({
  children,
  title,
}: {
  children: ReactElement;
  title: ReactNode;
}) {
  return (
    <Tooltip
      arrow
      placement="bottom-start"
      slotProps={balanceTooltipSlotProps}
      title={title}
    >
      {children}
    </Tooltip>
  );
}

export function BalanceTooltipText({
  description,
  formula,
}: {
  description: string;
  formula: string;
}) {
  return (
    <Box>
      <Typography
        component="div"
        sx={{ fontSize: "0.85rem", fontWeight: 700, mb: 0.5 }}
      >
        {description}
      </Typography>
      <Typography
        component="div"
        sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
      >
        {formula}
      </Typography>
    </Box>
  );
}
