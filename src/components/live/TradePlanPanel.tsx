"use client";

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import { Box, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import { useEffect } from "react";

import tradePlan, { type TradePlan } from "@/lib/system/utils/ui/trade-plan";

const ACTION_SX = { p: 0.5, "& svg": { fontSize: 17 } } as const;

function LevelRow({
  kind,
  label,
  color,
  price,
  plan,
  decimals,
  onRemove,
}: {
  kind: "entry" | "sl" | "tp";
  label: string;
  color: string;
  price: number;
  plan: TradePlan;
  decimals: number;
  onRemove?: () => void;
}) {
  const pct = tradePlan.pct(plan, price);
  const ratio = tradePlan.rr(plan, price);
  return (
    <Box sx={{ alignItems: "center", display: "grid", gap: 1, gridTemplateColumns: "40px 1fr 64px 44px 22px" }}>
      <Typography fontWeight={700} sx={{ color }} variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontVariantNumeric: "tabular-nums" }} variant="caption">
        {price.toFixed(decimals)}
      </Typography>
      <Typography color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }} variant="caption">
        {kind !== "entry" && `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}
      </Typography>
      <Typography color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }} variant="caption">
        {kind === "tp" && ratio !== undefined && `${ratio.toFixed(2)}R`}
      </Typography>
      {onRemove && (
        <IconButton onClick={onRemove} size="small" sx={{ p: 0.25, "& svg": { fontSize: 14 } }} title={`Remove ${label}`}>
          <CloseIcon />
        </IconButton>
      )}
    </Box>
  );
}

/**
 * Floating editor for the selected trade plan: level summary plus add TP,
 * flip, copy-as-JSON and delete (also the Delete key).
 */
export default function TradePlanPanel({
  plan,
  symbol,
  decimals,
  onChange,
  onRemove,
  onClose,
}: {
  plan: TradePlan;
  symbol: string;
  decimals: number;
  onChange: (plan: TradePlan) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], [role='combobox']")) return;
      if (event.key === "Delete" || event.key === "Backspace") onRemove();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onRemove]);

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify({ symbol, ...plan }));
  };
  // UTC, matching the chart's time axis.
  const time = (ms: number) =>
    new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

  return (
    <Paper
      elevation={6}
      sx={{ display: "grid", gap: 0.5, p: 1, position: "absolute", right: 96, top: 8, width: 268, zIndex: 3 }}
    >
      <Box sx={{ alignItems: "center", display: "flex", gap: 0.25 }}>
        <Typography fontWeight={700} sx={{ color: plan.side === "LONG" ? "#26a69a" : "#ef5350", flex: 1 }} variant="body2">
          {plan.side} plan
        </Typography>
        <Tooltip title="Add TP">
          <IconButton onClick={() => onChange(tradePlan.addTp(plan))} size="small" sx={ACTION_SX}>
            <AddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Flip long/short">
          <IconButton onClick={() => onChange(tradePlan.flip(plan))} size="small" sx={ACTION_SX}>
            <SwapVertIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Copy as JSON">
          <IconButton onClick={copy} size="small" sx={ACTION_SX}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete (Del)">
          <IconButton onClick={onRemove} size="small" sx={ACTION_SX}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close (Esc)">
          <IconButton onClick={onClose} size="small" sx={ACTION_SX}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>
      {[...plan.tp].reverse().map((price, reversed) => {
        const index = plan.tp.length - 1 - reversed;
        return (
          <LevelRow
            color="#26a69a"
            decimals={decimals}
            key={index}
            kind="tp"
            label={`TP${index + 1}`}
            onRemove={plan.tp.length > 1 ? () => onChange(tradePlan.removeTp(plan, index)) : undefined}
            plan={plan}
            price={price}
          />
        );
      })}
      <LevelRow color="text.secondary" decimals={decimals} kind="entry" label="Entry" plan={plan} price={plan.entry} />
      <LevelRow color="#ef5350" decimals={decimals} kind="sl" label="SL" plan={plan} price={plan.sl} />
      <Typography color="text.secondary" variant="caption">
        Entry from {time(plan.t)} · timeout {time(plan.end)} UTC ({tradePlan.formatSpan(plan.end - plan.t)})
      </Typography>
    </Paper>
  );
}
