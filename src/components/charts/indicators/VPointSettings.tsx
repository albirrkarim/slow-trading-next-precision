"use client";

import { Box, MenuItem, TextField, Typography } from "@mui/material";

import CommitField from "@/components/settings/Features/CommitField";
import chartIndicators, { type VPointSourceConfig } from "@/lib/system/utils/ui/chart-indicators";

/** Parses a percent in (0, 100]. */
function pctParser(text: string) {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= 100 ? { value } : { error: "Percent above 0" };
}

/** vPoint source: the engine's stored points, or fresh detection with custom thresholds. */
export default function VPointSettings({
  config,
  onChange,
}: {
  config: VPointSourceConfig;
  onChange: (patch: Partial<VPointSourceConfig>) => void;
}) {
  return (
    <Box sx={{ display: "grid", gap: 2, p: 2, width: 280 }}>
      <Typography variant="subtitle2">
        Volatility Points [{chartIndicators.vPointSource.label(config)}]
      </Typography>
      <TextField
        helperText={
          config.mode === "stored"
            ? "Points the engine detected and stored — only coins it tracks"
            : "Detected now on this chart's loaded candles — any coin, depends on interval"
        }
        label="Source"
        onChange={(event) => onChange({ mode: event.target.value as VPointSourceConfig["mode"] })}
        select
        size="small"
        value={config.mode}
      >
        <MenuItem value="stored">Stored (engine)</MenuItem>
        <MenuItem value="fresh">Fresh (detect on chart)</MenuItem>
      </TextField>
      {config.mode === "fresh" && (
        <>
          <CommitField
            helperText="% move from the last pivot that starts a sequence"
            label="Move threshold %"
            onCommit={(move: number) => onChange({ move })}
            parse={pctParser}
            size="small"
            value={config.move}
          />
          <CommitField
            helperText="% pullback from the extreme that confirms a pivot"
            label="Retrace threshold %"
            onCommit={(retrace: number) => onChange({ retrace })}
            parse={pctParser}
            size="small"
            value={config.retrace}
          />
        </>
      )}
    </Box>
  );
}
