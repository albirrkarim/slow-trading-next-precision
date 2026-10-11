"use client";

import {
  Box,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import chartIndicators, {
  VWAP_ANCHORS,
  VWAP_COLORS,
  type VwapIndicatorConfig,
} from "@/lib/system/utils/ui/chart-indicators";

function ColorSwatches({
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

export default function VwapSettings({
  config,
  hasEntryAnchor,
  onChange,
}: {
  config: VwapIndicatorConfig;
  hasEntryAnchor: boolean;
  onChange: (patch: Partial<VwapIndicatorConfig>) => void;
}) {
  const [bandsText, setBandsText] = useState(config.bands.join(", "));

  const commitBands = () => {
    const bands = chartIndicators.vwap.parseBands(bandsText);
    setBandsText(bands.join(", "));
    onChange({ bands });
  };

  return (
    <Box sx={{ p: 2, width: 260, display: "grid", gap: 2 }}>
      <Typography variant="subtitle2">
        {chartIndicators.vwap.label(config)}
      </Typography>
      <TextField
        label="Anchor period"
        onChange={(event) =>
          onChange({ anchor: event.target.value as VwapIndicatorConfig["anchor"] })
        }
        select
        size="small"
        value={config.anchor}
      >
        {VWAP_ANCHORS.filter(
          (option) =>
            option.value !== "entry" ||
            hasEntryAnchor ||
            config.anchor === "entry",
        ).map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {config.anchor === "month" && (
        <FormControlLabel
          control={
            <Checkbox
              checked={config.gate}
              onChange={(_, gate) => onChange({ gate })}
              size="small"
            />
          }
          label={
            <Box>
              <Typography variant="body2">Match gate (5m)</Typography>
              <Typography color="text.secondary" variant="caption">
                Fold the runtime&apos;s 5m candles from the month start — the
                exact VWAP and σ the feature gate measured
              </Typography>
            </Box>
          }
          sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.25 } }}
        />
      )}
      <TextField
        helperText="σ multipliers, e.g. 1, 2 or 1.2, 1.7 — empty for none"
        label="Bands"
        onBlur={commitBands}
        onChange={(event) => setBandsText(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && commitBands()}
        size="small"
        value={bandsText}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={config.fill}
            onChange={(_, fill) => onChange({ fill })}
            size="small"
          />
        }
        label={<Typography variant="body2">Fill bands</Typography>}
      />
      <ColorSwatches
        onChange={(color) => onChange({ color })}
        value={config.color}
      />
    </Box>
  );
}
