"use client";

import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import { Box, IconButton, Popover, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";

import chartIndicators from "@/lib/system/utils/ui/chart-indicators";

import type { ChartIndicatorsApi } from "./useChartIndicators";
import VwapSettings from "./VwapSettings";

const ACTION_SX = { p: 0.25, "& svg": { fontSize: 15 } } as const;

function LegendRow({
  color,
  label,
  visible,
  onToggle,
  onLabelClick,
  children,
}: {
  color: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
  onLabelClick?: (anchor: HTMLElement) => void;
  /** Extra hover actions after the eye toggle. */
  children?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        borderRadius: 1,
        "& .legend-actions": { opacity: 0, transition: "opacity 120ms" },
        "&:hover": { backgroundColor: "action.hover" },
        "&:hover .legend-actions": { opacity: 1 },
      }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          flexShrink: 0,
          backgroundColor: color,
          opacity: visible ? 1 : 0.35,
        }}
      />
      <Typography
        onClick={(event) => onLabelClick?.(event.currentTarget)}
        sx={{
          cursor: onLabelClick ? "pointer" : "default",
          opacity: visible ? 1 : 0.45,
          whiteSpace: "nowrap",
        }}
        variant="caption"
      >
        {label}
      </Typography>
      <Box className="legend-actions" sx={{ display: "flex" }}>
        <IconButton
          onClick={onToggle}
          size="small"
          sx={ACTION_SX}
          title={visible ? "Hide" : "Show"}
        >
          {visible ? <VisibilityIcon /> : <VisibilityOffIcon />}
        </IconButton>
        {children}
      </Box>
    </Box>
  );
}

/**
 * TradingView-style on-chart legend: one row per indicator with hover
 * actions (show/hide, settings, duplicate, remove).
 */
export default function IndicatorLegend({
  indicators,
  hasVPoints,
  hasEntryAnchor,
}: {
  indicators: ChartIndicatorsApi;
  hasVPoints: boolean;
  hasEntryAnchor: boolean;
}) {
  const [editing, setEditing] = useState<{
    id: string;
    anchorEl: HTMLElement;
  } | null>(null);
  const { config } = indicators;
  const editingConfig = config.vwaps.find((item) => item.id === editing?.id);

  if (!hasVPoints && config.vwaps.length === 0) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 4,
        left: 4,
        zIndex: 3,
        py: 0.25,
        borderRadius: 1,
        backgroundColor: (theme) =>
          theme.palette.mode === "dark"
            ? "rgba(18, 18, 18, 0.7)"
            : "rgba(255, 255, 255, 0.75)",
      }}
    >
      {hasVPoints && (
        <LegendRow
          color="#ef5350"
          label="Volatility Points"
          onToggle={() => indicators.setVPoints(!config.vPoints)}
          visible={config.vPoints}
        />
      )}
      {config.vwaps.map((item) => (
        <LegendRow
          color={item.color}
          key={item.id}
          label={chartIndicators.vwap.label(item)}
          onLabelClick={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          onToggle={() =>
            indicators.updateVwap(item.id, { visible: !item.visible })
          }
          visible={item.visible}
        >
          <IconButton
            onClick={(event) =>
              setEditing({ id: item.id, anchorEl: event.currentTarget })
            }
            size="small"
            sx={ACTION_SX}
            title="Settings"
          >
            <SettingsIcon />
          </IconButton>
          <IconButton
            onClick={() => indicators.duplicateVwap(item.id)}
            size="small"
            sx={ACTION_SX}
            title="Duplicate"
          >
            <ContentCopyIcon />
          </IconButton>
          <IconButton
            onClick={() => indicators.removeVwap(item.id)}
            size="small"
            sx={ACTION_SX}
            title="Remove"
          >
            <CloseIcon />
          </IconButton>
        </LegendRow>
      ))}
      <Popover
        anchorEl={editing?.anchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        onClose={() => setEditing(null)}
        open={Boolean(editing && editingConfig)}
      >
        {editingConfig && (
          <VwapSettings
            config={editingConfig}
            hasEntryAnchor={hasEntryAnchor}
            key={editingConfig.id}
            onChange={(patch) => indicators.updateVwap(editingConfig.id, patch)}
          />
        )}
      </Popover>
    </Box>
  );
}
