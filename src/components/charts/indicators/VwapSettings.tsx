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

import ColorSwatches from "./ColorSwatches";

import {
  INDICATOR_INTERVALS,
  type FeatureIndicatorInterval,
} from "@/lib/features/indicators";

import chartIndicators, {
  VWAP_ANCHORS,
  type VwapIndicatorConfig,
} from "@/lib/system/utils/ui/chart-indicators";

const GATE_ANCHORS: VwapIndicatorConfig["anchor"][] = ["session", "week", "month"];

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
      {GATE_ANCHORS.includes(config.anchor) && (
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
              <Typography variant="body2">Match runtime candles</Typography>
              <Typography color="text.secondary" variant="caption">
                Fold closed {config.src ?? "5m"} candles from the anchor start —
                the exact VWAP and σ the runtime feature measured
              </Typography>
            </Box>
          }
          sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.25 } }}
        />
      )}
      {config.gate && GATE_ANCHORS.includes(config.anchor) && (
        <TextField
          label="Runtime candles"
          onChange={(event) => onChange({ src: event.target.value as FeatureIndicatorInterval })}
          select
          size="small"
          value={config.src ?? "5m"}
        >
          {INDICATOR_INTERVALS.map((interval) => (
            <MenuItem key={interval} value={interval}>
              {interval}
            </MenuItem>
          ))}
        </TextField>
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
