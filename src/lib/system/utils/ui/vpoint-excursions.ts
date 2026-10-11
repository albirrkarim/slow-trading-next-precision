/**
 * vPoint markers with max excursions for live charts. The engine tracks
 * `maxUpPct`/`maxDownPct` only in memory and only on each coin's newest
 * point (BOTH:BLOCK_ENTRY_VPOINT_MIGHT_FORMED); this rebuilds them from
 * candle closes so the chart can show them. Pure; no I/O.
 */
import type { UTCTimestamp } from "lightweight-charts";

import type { VolatilityPoint } from "../../types";
import type { Marker } from "./chart-markers";
import { convertVolatilityToMarkers } from "./chart-markers";

/** Engine entry guard: excursions at 90% of the move threshold block entries. */
const GUARD_RATIO = 0.9;
const WARN_COLOR = "#ff9800";

interface CloseCandle {
  /** Open time, chart seconds. */
  time: number;
  close: number;
}

/** Largest up/down move of `closes` relative to `price`, percent (≥ 0). */
function excursion(price: number, closes: number[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const close of closes) {
    const drift = ((close - price) / price) * 100;
    if (drift > up) up = drift;
    if (-drift > down) down = -drift;
  }
  return { down, up };
}

/** "↑0.40% ↓3.10%" */
function format({ up, down }: { up: number; down: number }): string {
  return `↑${up.toFixed(2)}% ↓${down.toFixed(2)}%`;
}

/**
 * Markers for `points` on a chart of `intervalMs` candles:
 * - each marker snaps to the candle containing its point (so hover works
 *   on any interval) and carries its price + an excursion tooltip — the
 *   max move of closes after the point until the next point formed;
 * - the newest point's excursions run to the latest candle (the forming
 *   one included, i.e. the live mark) and also show in its label, colored
 *   once either side reaches 90% of `moveThresholdPct` — where the engine
 *   starts blocking entries because an opposite point is likely forming.
 */
function markers({
  points,
  candles,
  intervalMs,
  moveThresholdPct,
}: {
  points: VolatilityPoint[];
  candles: CloseCandle[];
  intervalMs: number;
  moveThresholdPct: number;
}): Marker[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const base = convertVolatilityToMarkers(sorted);
  let cursor = 0;

  return sorted.map((point, index) => {
    const next = sorted[index + 1];
    const newest = next === undefined;
    // Closes strictly after the point's own candle, until the next point.
    const startSec = Math.floor(point.t / intervalMs) * (intervalMs / 1000);
    while (cursor < candles.length && candles[cursor].time <= startSec) cursor += 1;
    const closes: number[] = [];
    for (let i = cursor; i < candles.length; i++) {
      if (!newest && candles[i].time * 1000 >= next.t) break;
      closes.push(candles[i].close);
    }
    const moved = excursion(point.p, closes);
    const guarded = Math.max(moved.up, moved.down) >= moveThresholdPct * GUARD_RATIO;
    const marker = base[index];
    return {
      ...marker,
      ...(newest && {
        color: guarded ? WARN_COLOR : marker.color,
        text: `${marker.text} · ${format(moved)}`,
      }),
      price: point.p,
      time: startSec as UTCTimestamp,
      tooltipText:
        `${newest ? "Since formed (live)" : "Until the next point"}: ` +
        `max ↑ ${moved.up.toFixed(2)}% / max ↓ ${moved.down.toFixed(2)}%` +
        (newest && guarded ? ` — ≥ ${GUARD_RATIO * 100}% of the ${moveThresholdPct}% move: entries blocked` : ""),
      tooltipTitle: marker.text,
    };
  });
}

const vpointExcursions = { excursion, markers } as const;

export default vpointExcursions;
