"use client";

import { Box } from "@mui/material";

import { VWAP_COLORS } from "@/lib/system/utils/ui/chart-indicators";

export default function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
      {VWAP_COLORS.map((color) => (
        <Box
          component="button"
          key={color}
          onClick={() => onChange(color)}
          title={color}
          type="button"
          sx={{
            width: 22,
            height: 22,
            p: 0,
            borderRadius: "50%",
            cursor: "pointer",
            backgroundColor: color,
            border: 2,
            borderColor: color === value ? "text.primary" : "transparent",
            outline: "1px solid",
            outlineColor: "divider",
          }}
        />
      ))}
    </Box>
  );
}
