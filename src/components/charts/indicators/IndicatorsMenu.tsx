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

import type { ChartIndicatorsApi } from "./useChartIndicators";

export default function IndicatorsMenu({
  indicators,
  hasVPoints,
}: {
  indicators: ChartIndicatorsApi;
  /** The chart has a vPoint layer to toggle. */
  hasVPoints: boolean;
}) {
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
      <Menu anchorEl={anchorEl} onClose={close} open={Boolean(anchorEl)}>
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
