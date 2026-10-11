"use client";

import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import InsightsIcon from "@mui/icons-material/Insights";
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
} from "@mui/material";
import { useState } from "react";

import featureIndicators, { type FeatureIndicatorDefs } from "@/lib/features/indicators";
import chartIndicators from "@/lib/system/utils/ui/chart-indicators";

import type { ChartIndicatorsApi } from "./useChartIndicators";

export default function IndicatorsMenu({
  indicators,
  hasVPoints,
  featureDefs,
}: {
  indicators: ChartIndicatorsApi;
  /** The chart has a vPoint layer to toggle. */
  hasVPoints: boolean;
  /** Indicator definitions captured with the trade/row. */
  featureDefs?: FeatureIndicatorDefs;
}) {
  const defs = Object.values(featureDefs ?? {});
  const missingDefs = defs.filter(
    (def) => !chartIndicators.hasDef(indicators.config, def),
  ).length;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const close = () => setAnchorEl(null);

  return (
    <>
      <Button
        onClick={(event) => setAnchorEl(event.currentTarget)}
        size="small"
        startIcon={<InsightsIcon fontSize="small" />}
        sx={{ height: 34, textTransform: "none" }}
        variant="outlined"
      >
        Indicators
      </Button>
      <Menu
        anchorEl={anchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        onClose={close}
        open={Boolean(anchorEl)}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <ListSubheader sx={{ lineHeight: "32px" }}>Add</ListSubheader>
        <MenuItem
          onClick={() => {
            indicators.addVwap();
            close();
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="VWAP (Anchored)"
            secondary={`${indicators.config.vwaps.length} on chart`}
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            indicators.addSupertrend();
            close();
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Supertrend"
            secondary={`${indicators.config.supertrends.length} on chart`}
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            indicators.addEma();
            close();
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="EMA"
            secondary={`${indicators.config.emas.length} on chart`}
          />
        </MenuItem>
        {defs.length > 0 && (
          <MenuItem
            disabled={missingDefs === 0}
            onClick={() => {
              indicators.addFromDefs(featureDefs ?? {});
              close();
            }}
          >
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={
                missingDefs === 0
                  ? "Captured features — all on chart"
                  : `From captured features (${missingDefs} new)`
              }
              secondary={
                <>
                  {defs.map((def) => (
                    <span key={def.id} style={{ display: "block" }}>
                      {chartIndicators.hasDef(indicators.config, def) ? "✓ " : "+ "}
                      {def.id}: {featureIndicators.config.summary(def)}
                    </span>
                  ))}
                </>
              }
              slotProps={{ secondary: { sx: { maxWidth: 300 } } }}
            />
          </MenuItem>
        )}
        {hasVPoints && <Divider />}
        {hasVPoints && (
          <ListSubheader sx={{ lineHeight: "32px" }}>Layers</ListSubheader>
        )}
        {hasVPoints && (
          <MenuItem
            onClick={() => indicators.setVPoints(!indicators.config.vPoints)}
          >
            <ListItemIcon>
              {indicators.config.vPoints && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText primary="Volatility Points" />
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
