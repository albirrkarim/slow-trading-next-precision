"use client";

import { Box, Tooltip } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Inline help hint — wraps its content in a dashed underline + help cursor
 * and shows `title` in a tooltip. Use for single values/labels whose meaning
 * needs an explanation without cluttering the layout.
 */
export default function HintTooltip({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <Tooltip arrow enterTouchDelay={0} title={title}>
      <Box
        component="span"
        tabIndex={0}
        sx={{
          borderBottom: "1px dashed",
          borderColor: "text.disabled",
          cursor: "help",
          display: "inline-flex",
          "&:hover, &:focus-visible": { borderColor: "text.secondary" },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
