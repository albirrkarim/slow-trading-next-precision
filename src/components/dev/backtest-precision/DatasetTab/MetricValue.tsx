"use client";

import { Box, Tooltip } from "@mui/material";
import type { ReactNode } from "react";

export default function MetricValue({ children, detail }: { children: ReactNode; detail: string }) {
  return (
    <Tooltip arrow enterTouchDelay={0} title={detail}>
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
