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
import EmaSettings from "./EmaSettings";
import SupertrendSettings from "./SupertrendSettings";
import type { SourceCandles } from "./useSourceCandles";
import VPointSettings from "./VPointSettings";
import VwapSettings from "./VwapSettings";

/** Popover id of the V-Points row (instance ids are random 6-char strings). */
const VPOINTS_ID = "__vpoints";

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
          background: color,
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

/** Settings / duplicate / remove hover actions of one instance row. */
function ItemActions({
  onSettings,
  onDuplicate,
  onRemove,
}: {
  onSettings: (anchor: HTMLElement) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <IconButton
        onClick={(event) => onSettings(event.currentTarget)}
        size="small"
        sx={ACTION_SX}
        title="Settings"
      >
        <SettingsIcon />
      </IconButton>
      <IconButton onClick={onDuplicate} size="small" sx={ACTION_SX} title="Duplicate">
        <ContentCopyIcon />
      </IconButton>
      <IconButton onClick={onRemove} size="small" sx={ACTION_SX} title="Remove">
        <CloseIcon />
      </IconButton>
    </>
  );
}

/** Appends a loading note while an instance's source candles are fetched. */
function withLoading(label: string, source: string | undefined, sourceCandles: SourceCandles) {
  return source && !sourceCandles[source as keyof SourceCandles]
    ? `${label} · loading ${source}…`
    : label;
}

/**
 * TradingView-style on-chart legend: one row per indicator with hover
 * actions (show/hide, settings, duplicate, remove).
 */
export default function IndicatorLegend({
  indicators,
  hasVPoints,
  hasPlan = false,
  hasEntryAnchor,
  sourceCandles,
  vPointSource = false,
}: {
  indicators: ChartIndicatorsApi;
  hasVPoints: boolean;
  /** The chart has a trade plan to show or hide. */
  hasPlan?: boolean;
  hasEntryAnchor: boolean;
  /** Loaded runtime-faithful source candles, by interval. */
  sourceCandles: SourceCandles;
  /** The chart can switch vPoints between stored and fresh — show the tag and settings. */
  vPointSource?: boolean;
}) {
  const [editing, setEditing] = useState<{
    id: string;
    anchorEl: HTMLElement;
  } | null>(null);
  const { config } = indicators;
  const editingVwap = config.vwaps.find((item) => item.id === editing?.id);
  const editingSupertrend = config.supertrends.find((item) => item.id === editing?.id);
  const editingEma = config.emas.find((item) => item.id === editing?.id);
  const editingVPoints = editing?.id === VPOINTS_ID;

  if (
    !hasVPoints &&
    !hasPlan &&
    config.vwaps.length === 0 &&
    config.supertrends.length === 0 &&
    config.emas.length === 0
  ) {
    return null;
  }

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
          label={
            vPointSource
              ? `Volatility Points [${chartIndicators.vPointSource.label(config.vPointSource)}]`
              : "Volatility Points"
          }
          onLabelClick={
            vPointSource ? (anchorEl) => setEditing({ id: VPOINTS_ID, anchorEl }) : undefined
          }
          onToggle={() => indicators.setVPoints(!config.vPoints)}
          visible={config.vPoints}
        >
          {vPointSource && (
            <IconButton
              onClick={(event) => setEditing({ id: VPOINTS_ID, anchorEl: event.currentTarget })}
              size="small"
              sx={ACTION_SX}
              title="Settings"
            >
              <SettingsIcon />
            </IconButton>
          )}
        </LegendRow>
      )}
      {hasPlan && (
        <LegendRow
          color="linear-gradient(180deg, #26a69a 50%, #ef5350 50%)"
          label="Trade Plan"
          onToggle={() => indicators.setPlan(!config.plan)}
          visible={config.plan}
        />
      )}
      {config.vwaps.map((item) => (
        <LegendRow
          color={item.color}
          key={item.id}
          label={withLoading(
            chartIndicators.vwap.label(item),
            item.visible ? chartIndicators.vwap.source(item) : undefined,
            sourceCandles,
          )}
          onLabelClick={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          onToggle={() =>
            indicators.updateVwap(item.id, { visible: !item.visible })
          }
          visible={item.visible}
        >
          <ItemActions
            onDuplicate={() => indicators.duplicateVwap(item.id)}
            onRemove={() => indicators.removeVwap(item.id)}
            onSettings={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          />
        </LegendRow>
      ))}
      {config.supertrends.map((item) => (
        <LegendRow
          color="linear-gradient(90deg, #26a69a 50%, #ef5350 50%)"
          key={item.id}
          label={withLoading(
            chartIndicators.supertrend.label(item),
            item.visible ? item.src : undefined,
            sourceCandles,
          )}
          onLabelClick={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          onToggle={() =>
            indicators.updateSupertrend(item.id, { visible: !item.visible })
          }
          visible={item.visible}
        >
          <ItemActions
            onDuplicate={() => indicators.duplicateSupertrend(item.id)}
            onRemove={() => indicators.removeSupertrend(item.id)}
            onSettings={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          />
        </LegendRow>
      ))}
      {config.emas.map((item) => (
        <LegendRow
          color={item.color}
          key={item.id}
          label={withLoading(
            chartIndicators.ema.label(item),
            item.visible ? item.src : undefined,
            sourceCandles,
          )}
          onLabelClick={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          onToggle={() => indicators.updateEma(item.id, { visible: !item.visible })}
          visible={item.visible}
        >
          <ItemActions
            onDuplicate={() => indicators.duplicateEma(item.id)}
            onRemove={() => indicators.removeEma(item.id)}
            onSettings={(anchorEl) => setEditing({ id: item.id, anchorEl })}
          />
        </LegendRow>
      ))}
      <Popover
        anchorEl={editing?.anchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        onClose={() => setEditing(null)}
        open={Boolean(editing && (editingVwap || editingSupertrend || editingEma || editingVPoints))}
      >
        {editingVwap && (
          <VwapSettings
            config={editingVwap}
            hasEntryAnchor={hasEntryAnchor}
            key={editingVwap.id}
            onChange={(patch) => indicators.updateVwap(editingVwap.id, patch)}
          />
        )}
        {editingVPoints && (
          <VPointSettings
            config={config.vPointSource}
            onChange={indicators.updateVPointSource}
          />
        )}
        {editingEma && (
          <EmaSettings
            config={editingEma}
            key={editingEma.id}
            onChange={(patch) => indicators.updateEma(editingEma.id, patch)}
          />
        )}
        {editingSupertrend && (
          <SupertrendSettings
            config={editingSupertrend}
            key={editingSupertrend.id}
            onChange={(patch) => indicators.updateSupertrend(editingSupertrend.id, patch)}
          />
        )}
      </Popover>
    </Box>
  );
}
