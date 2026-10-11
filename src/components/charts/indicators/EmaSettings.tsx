"use client";

import { Box, MenuItem, TextField, Typography } from "@mui/material";

import CommitField from "@/components/settings/Features/CommitField";
import {
  INDICATOR_INTERVALS,
  type EmaSource,
  type FeatureIndicatorInterval,
} from "@/lib/features/indicators";
import chartIndicators, { type EmaChartConfig } from "@/lib/system/utils/ui/chart-indicators";

import ColorSwatches from "./ColorSwatches";

const CHART_SOURCE = "chart";

export default function EmaSettings({
  config,
  onChange,
}: {
  config: EmaChartConfig;
  onChange: (patch: Partial<EmaChartConfig>) => void;
}) {
  return (
    <Box sx={{ p: 2, width: 260, display: "grid", gap: 2 }}>
      <Typography variant="subtitle2">{chartIndicators.ema.label(config)}</Typography>
      <CommitField
        label="Length"
        onCommit={(length: number) => onChange({ length })}
        parse={(text) => {
          const value = Number(text);
          return Number.isInteger(value) && value >= 1 && value <= 500
            ? { value }
            : { error: "Integer 1–500" };
        }}
        size="small"
        value={config.length}
      />
      <TextField
        label="Source"
        onChange={(event) => onChange({ source: event.target.value as EmaSource })}
        select
        size="small"
        value={config.source}
      >
        {chartIndicators.ema.sources.map((source) => (
          <MenuItem key={source} value={source}>
            {source}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        helperText="Fold another interval's candles (with warm-up) like the runtime feature does"
        label="Candles"
        onChange={(event) =>
          onChange({
            src:
              event.target.value === CHART_SOURCE
                ? undefined
                : (event.target.value as FeatureIndicatorInterval),
          })
        }
        select
        size="small"
        value={config.src ?? CHART_SOURCE}
      >
        <MenuItem value={CHART_SOURCE}>Chart candles</MenuItem>
        {INDICATOR_INTERVALS.map((interval) => (
          <MenuItem key={interval} value={interval}>
            {interval}
          </MenuItem>
        ))}
      </TextField>
      <ColorSwatches onChange={(color) => onChange({ color })} value={config.color} />
    </Box>
  );
}
