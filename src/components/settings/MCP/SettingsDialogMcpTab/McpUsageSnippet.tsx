"use client";

import {
  Box,
  Typography,
} from "@mui/material";

export function McpUsageSnippet(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <Box>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Box
        component="pre"
        sx={(theme) => ({
          backgroundColor: theme.palette.action.hover,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          fontFamily: "monospace",
          fontSize: "0.78rem",
          lineHeight: 1.45,
          m: 0,
          mt: 0.5,
          overflowX: "auto",
          p: 1,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        })}
      >
        {value}
      </Box>
    </Box>
  );
}
