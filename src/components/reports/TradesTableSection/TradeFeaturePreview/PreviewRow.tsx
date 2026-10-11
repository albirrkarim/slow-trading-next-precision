"use client";

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** One value chip-free token; wraps only between tokens, never inside. */
export function Item({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <Typography color={color} component="span" sx={{ whiteSpace: "nowrap" }} variant="body2">
      {children}
    </Typography>
  );
}

/** Label column + wrapping value tokens — one topic per row. */
export default function PreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
      <Typography
        color="text.secondary"
        component="span"
        sx={{ flexShrink: 0, fontSize: 11, textTransform: "uppercase", width: 48 }}
        variant="caption"
      >
        {label}
      </Typography>
      <Box sx={{ alignItems: "baseline", columnGap: 1.25, display: "flex", flexWrap: "wrap", minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}
