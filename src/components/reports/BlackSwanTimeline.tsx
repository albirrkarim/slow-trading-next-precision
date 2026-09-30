"use client";

import { Box, Tooltip, Typography, useTheme } from "@mui/material";
import moment from "moment";

import type {
  BlackSwanStatus,
  BlackSwanTimeline,
} from "@/lib/system/trading/black-swan";

export interface BlackSwanTimelineVisibleRange {
  startTime: number;
  endTime: number;
}

type BandKind = BlackSwanStatus | "DISABLED" | "NOT_RECORDED" | "WARMUP";

interface Band {
  kind: BandKind;
  /** Logical (unclipped) interval start — tooltips report it verbatim. */
  start: number;
  /** Logical (unclipped) interval end — tooltips report it verbatim. */
  end: number;
  leftPct: number;
  widthPct: number;
}

const LEGEND_ORDER: BandKind[] = [
  "NORMAL",
  "WATCH",
  "CRISIS",
  "RECOVERY",
  "DISABLED",
  "WARMUP",
  "NOT_RECORDED",
];

const LEGEND_LABELS: Record<BandKind, string> = {
  CRISIS: "Crisis",
  DISABLED: "Disabled",
  NORMAL: "Normal",
  NOT_RECORDED: "Not recorded",
  RECOVERY: "Recovery",
  WARMUP: "Warm-up",
  WATCH: "Watch",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatUtc(t: number): string {
  return `${moment.utc(t).format("DD MMM YYYY HH:mm")} UTC`;
}

/** Tooltip text — always the full recorded interval, never clipped bounds. */
function bandLabel(band: Pick<Band, "kind" | "start" | "end">): string {
  const interval = `${formatUtc(band.start)} to ${formatUtc(band.end)}`;
  switch (band.kind) {
    case "WARMUP":
      return `Warm-up: detector not evaluated from ${interval}`;
    case "NOT_RECORDED":
      return `Not recorded from ${interval}`;
    default:
      return `${band.kind} from ${interval}`;
  }
}

export default function BlackSwanTimeline({
  datasetEndTimeMs,
  datasetStartTimeMs,
  timeline,
  unavailableMessage =
    "Black Swan history unavailable for this saved run. Rerun to record it.",
  visibleRange,
  warmupEndTimeMs,
}: {
  /** Full-axis start bound (dataset/config window start) when finite. */
  datasetStartTimeMs?: number;
  /** Full-axis end bound (dataset/config window end) when finite. */
  datasetEndTimeMs?: number;
  timeline?: BlackSwanTimeline;
  /** Message shown when no history was recorded for this run/state. */
  unavailableMessage?: string;
  /** Chart-reported visible domain; invalid values fall back to full bounds. */
  visibleRange?: BlackSwanTimelineVisibleRange;
  /** Explicit warmup boundary — supplied by backtests only. */
  warmupEndTimeMs?: number;
}) {
  const theme = useTheme();

  const colors: Record<BandKind, string> = {
    CRISIS: theme.palette.error.main,
    DISABLED: theme.palette.action.disabled,
    NORMAL: theme.palette.success.main,
    NOT_RECORDED: theme.palette.action.disabledBackground,
    RECOVERY: theme.palette.info.main,
    WARMUP: theme.palette.action.disabledBackground,
    WATCH: theme.palette.warning.main,
  };

  const domain = (() => {
    const candidates: Array<
      [number | undefined, number | undefined]
    > = [
      [visibleRange?.startTime, visibleRange?.endTime],
      [datasetStartTimeMs, datasetEndTimeMs],
      [timeline?.startTime, timeline?.endTime],
    ];
    for (const [start, end] of candidates) {
      if (finite(start) && finite(end) && end > start) {
        return { end, start };
      }
    }
    return null;
  })();

  const bands = ((): Band[] => {
    if (!timeline || !domain) return [];
    const { start: a, end: b } = domain;
    const fullStart = finite(datasetStartTimeMs)
      ? datasetStartTimeMs
      : timeline.startTime;
    const fullEnd = finite(datasetEndTimeMs)
      ? datasetEndTimeMs
      : timeline.endTime;

    const raw: Array<Pick<Band, "kind" | "start" | "end">> = [];
    const hasWarmup = finite(warmupEndTimeMs) && warmupEndTimeMs > fullStart;
    if (hasWarmup) {
      raw.push({
        end: Math.min(warmupEndTimeMs, fullEnd),
        kind: "WARMUP",
        start: fullStart,
      });
    }
    const recordStart = hasWarmup ? warmupEndTimeMs : fullStart;
    const firstT = timeline.segments[0]?.t ?? timeline.endTime;
    if (firstT > recordStart) {
      raw.push({ end: firstT, kind: "NOT_RECORDED", start: recordStart });
    }
    for (const [index, segment] of timeline.segments.entries()) {
      raw.push({
        end: timeline.segments[index + 1]?.t ?? timeline.endTime,
        kind: segment.enabled === false ? "DISABLED" : segment.status,
        start: segment.t,
      });
    }
    if (fullEnd > timeline.endTime) {
      raw.push({
        end: fullEnd,
        kind: "NOT_RECORDED",
        start: timeline.endTime,
      });
    }

    const merged: Array<Pick<Band, "kind" | "start" | "end">> = [];
    for (const band of raw) {
      const previous = merged[merged.length - 1];
      if (previous && previous.kind === band.kind && previous.end >= band.start) {
        previous.end = Math.max(previous.end, band.end);
      } else {
        merged.push({ ...band });
      }
    }

    return merged
      .map((band) => {
        const clippedStart = Math.max(band.start, a);
        const clippedEnd = Math.min(band.end, b);
        return {
          ...band,
          clippedEnd,
          clippedStart,
        };
      })
      .filter((band) => band.clippedEnd > band.clippedStart)
      .map((band) => ({
        end: band.end,
        kind: band.kind,
        leftPct: (100 * (band.clippedStart - a)) / (b - a),
        start: band.start,
        widthPct: (100 * (band.clippedEnd - band.clippedStart)) / (b - a),
      }));
  })();

  if (!timeline) {
    return (
      <Typography color="text.secondary" sx={{ py: 0.5 }} variant="body2">
        {unavailableMessage}
      </Typography>
    );
  }

  if (!timeline.enabled && timeline.segments.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 0.5 }} variant="body2">
        Black Swan protection disabled for this run.
      </Typography>
    );
  }

  if (timeline.startTime === timeline.endTime) {
    return (
      <Typography color="text.secondary" sx={{ py: 0.5 }} variant="body2">
        Recording Black Swan history; waiting for the next evaluation.
      </Typography>
    );
  }

  if (!domain) {
    return (
      <Typography color="text.secondary" sx={{ py: 0.5 }} variant="body2">
        {unavailableMessage}
      </Typography>
    );
  }

  const legendKinds = LEGEND_ORDER.filter((kind) =>
    bands.some((band) => band.kind === kind),
  );

  return (
    <Box sx={{ minWidth: 0, width: "100%" }}>
      <Box
        aria-label="Black Swan status history"
        role="group"
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          height: 22,
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        {bands.map((band, index) => {
          const label = bandLabel(band);
          return (
            <Tooltip arrow key={index} title={label}>
              <Box
                aria-label={label}
                style={{
                  left: `${band.leftPct}%`,
                  width: `${band.widthPct}%`,
                }}
                sx={{
                  bgcolor: colors[band.kind],
                  bottom: 0,
                  position: "absolute",
                  top: 0,
                  "&:focus-visible": {
                    outline: `2px solid ${theme.palette.text.primary}`,
                    outlineOffset: -2,
                  },
                }}
                tabIndex={0}
              />
            </Tooltip>
          );
        })}
      </Box>
      {legendKinds.length > 0 && (
        <Box
          sx={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 1,
            mt: 0.5,
          }}
        >
          {legendKinds.map((kind) => (
            <Box
              key={kind}
              sx={{ alignItems: "center", display: "flex", gap: 0.5 }}
            >
              <Box
                sx={{
                  bgcolor: colors[kind],
                  borderRadius: 0.5,
                  height: 8,
                  width: 12,
                }}
              />
              <Typography color="text.secondary" variant="caption">
                {LEGEND_LABELS[kind]}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
