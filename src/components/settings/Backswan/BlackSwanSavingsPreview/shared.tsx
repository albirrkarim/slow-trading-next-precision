"use client";

import {
  Box,
  Typography,
} from "@mui/material";

export const REQUEST_DEBOUNCE_MS = 650;
export const DEFAULT_START_T = Date.parse("2025-10-10T18:00:00.000Z");
export const DEFAULT_END_T = Date.parse("2025-10-11T12:00:00.000Z");

export function localInput(t: number): string {
  const date = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function formatUsdt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function SummaryMetric(props: {
  color?: string;
  label: string;
  value: string;
}) {
  return (
    <Box>
      <Typography color="text.secondary" variant="caption">
        {props.label}
      </Typography>
      <Typography
        color={props.color}
        fontWeight={800}
        sx={{ fontVariantNumeric: "tabular-nums" }}
        variant="h6"
      >
        {props.value}
      </Typography>
    </Box>
  );
}
