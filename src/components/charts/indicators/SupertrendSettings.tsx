"use client";

import { Box, MenuItem, TextField, Typography } from "@mui/material";

import CommitField from "@/components/settings/Features/CommitField";
import {
  INDICATOR_INTERVALS,
  type FeatureIndicatorInterval,
} from "@/lib/features/indicators";
import chartIndicators, {
  type SupertrendChartConfig,
} from "@/lib/system/utils/ui/chart-indicators";

const CHART_SOURCE = "chart";

/** Parses a finite number inside `[min, max]`. */
function numberParser(min: number, max: number, integer = false) {
  return (text: string) => {
    const value = Number(text);
    return !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))
      ? { error: `${min}–${max}` }
      : { value };
  };
}

export default function SupertrendSettings({
  config,
  onChange,
}: {
  config: SupertrendChartConfig;
  onChange: (patch: Partial<SupertrendChartConfig>) => void;
}) {
  return (
    <Box sx={{ p: 2, width: 260, display: "grid", gap: 2 }}>
      <Typography variant="subtitle2">{chartIndicators.supertrend.label(config)}</Typography>
      <CommitField
        label="ATR length"
        onCommit={(atrLength: number) => onChange({ atrLength })}
        parse={numberParser(1, 500, true)}
        size="small"
        value={config.atrLength}
      />
      <CommitField
        label="Factor"
        onCommit={(factor: number) => onChange({ factor })}
        parse={numberParser(0.1, 50)}
        size="small"
        value={config.factor}
      />
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
    </Box>
  );
}
