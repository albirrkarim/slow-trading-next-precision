"use client";

import type { VwapAnchor, VwapIndicatorConfig } from "@/lib/system/utils/ui/vwap";
import {
  Checkbox,
  FormControlLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";

const ANCHOR_OPTIONS: { value: VwapAnchor; label: string }[] = [
  { value: "session", label: "Session" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All data" },
  { value: "entry", label: "Entry" },
  { value: "vpoint", label: "V-Points" },
];

const BAND_OPTIONS: { value: string; bands: number[] }[] = [
  { value: "off", bands: [] },
  { value: "1", bands: [1] },
  { value: "1,2", bands: [1, 2] },
  { value: "1,2,3", bands: [1, 2, 3] },
];

const SELECT_SX = { minWidth: 96, height: 34, fontSize: "0.875rem" } as const;

export default function VwapControls({
  anchor,
  config,
  hasEntryAnchor,
  onChange,
}: {
  /** Resolved anchor — differs from `config.anchor` on entry fallback. */
  anchor: VwapAnchor;
  config: VwapIndicatorConfig;
  hasEntryAnchor: boolean;
  onChange: (patch: Partial<VwapIndicatorConfig>) => void;
}) {
  return (
    <>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.enabled}
            onChange={(_, checked) => onChange({ enabled: checked })}
          />
        }
        label={<Typography variant="body2">VWAP</Typography>}
        sx={{ mr: 0 }}
      />
      {config.enabled && (
        <>
          <Select
            value={anchor}
            onChange={(event) =>
              onChange({ anchor: event.target.value as VwapAnchor })
            }
            size="small"
            variant="outlined"
            sx={SELECT_SX}
            title="VWAP anchor period"
          >
            {ANCHOR_OPTIONS.filter(
              (option) => option.value !== "entry" || hasEntryAnchor,
            ).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
          <Select
            value={config.bands.join(",") || "off"}
            onChange={(event) =>
              onChange({
                bands:
                  BAND_OPTIONS.find(
                    (option) => option.value === event.target.value,
                  )?.bands ?? [],
              })
            }
            size="small"
            variant="outlined"
            sx={SELECT_SX}
            title="VWAP standard-deviation bands"
          >
            {BAND_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.value === "off" ? "No bands" : `±${option.value}σ`}
              </MenuItem>
            ))}
          </Select>
        </>
      )}
    </>
  );
}
