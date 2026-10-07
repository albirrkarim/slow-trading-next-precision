"use client";

import { alpha, Box } from "@mui/material";
import type { ReactNode } from "react";

export default function FrequencyHeatRow({
  children,
  heatPct,
  index,
}: {
  children: ReactNode;
  heatPct: number;
  index: number;
}) {
  return (
    <Box
      sx={{
        alignItems: "center",
        borderTop: index === 0 ? 0 : 1,
        borderColor: "divider",
        backgroundImage: (theme) =>
          `linear-gradient(to left, ${alpha(theme.palette.primary.main, 0.28)}, ${alpha(theme.palette.primary.main, 0.08)} 68%, transparent)`,
        backgroundPosition: "right center",
        backgroundRepeat: "no-repeat",
        backgroundSize: `${heatPct}% 100%`,
        display: "flex",
        justifyContent: "space-between",
        px: 1.25,
        py: 0.75,
      }}
    >
      {children}
    </Box>
  );
}
