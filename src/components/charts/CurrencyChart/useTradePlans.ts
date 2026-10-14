"use client";

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import tradePlan, {
  type TradePlan,
  type TradePlanHandle,
  type TradePlanPoint,
} from "@/lib/system/utils/ui/trade-plan";

import { TradePlanPrimitive } from "./TradePlanPrimitive";
import type { CandlePoint } from "./types";

/** Pointer travel (px) under which a press on empty chart counts as a click. */
const CLICK_SLOP_PX = 4;

interface DragState {
  origin: TradePlan;
  handle: TradePlanHandle;
  from: TradePlanPoint;
  draft: TradePlan;
}

/**
 * Draws trade plans on the candle series and lets the pointer drag their
 * entry, TP, SL, entry-time and timeout handles (or the whole box). The
 * drag previews inside the primitive and commits once on release; a press
 * on a plan never reaches the chart's own pan handling. While `placing`,
 * a click on empty chart reports the bar-snapped point to `onPlace`
 * instead of clearing the selection. Without `onChange` the plans are
 * drawn read-only.
 */
export function useTradePlans({
  chartRef,
  seriesRef,
  containerRef,
  data,
  plans,
  selectedId,
  onChange,
  onSelect,
  placing,
  onPlace,
}: {
  chartRef: { current: IChartApi | null };
  seriesRef: { current: ISeriesApi<any> | null };
  containerRef: { current: HTMLDivElement | null };
  data: CandlePoint[];
  plans: TradePlan[] | undefined;
  selectedId: string | null | undefined;
  onChange: ((plans: TradePlan[]) => void) | undefined;
  onSelect: ((id: string | null) => void) | undefined;
  placing: boolean;
  onPlace: ((point: TradePlanPoint, stepMs: number) => void) | undefined;
}) {
  const enabled = Boolean(plans);
  const editable = enabled && Boolean(onChange);
  const primitiveRef = useRef<TradePlanPrimitive | null>(null);
  const latest = useRef({ onChange, onPlace, onSelect, placing, plans });
  useEffect(() => {
    latest.current = { onChange, onPlace, onSelect, placing, plans };
  }, [onChange, onPlace, onSelect, placing, plans]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!enabled || !series) return;
    const primitive = new TradePlanPrimitive();
    series.attachPrimitive(primitive);
    primitiveRef.current = primitive;
    // eslint-disable-next-line consistent-return
    return () => {
      primitiveRef.current = null;
      // On unmount the chart is removed first (its cleanup clears
      // `seriesRef`); detaching then would schedule a redraw on a disposed
      // chart.
      if (seriesRef.current !== series) return;
      series.detachPrimitive(primitive);
    };
  }, [enabled, seriesRef]);

  // Times only change when a candle opens or history loads, not per tick.
  const timesKey = `${data.length}:${data[0]?.time}:${data.at(-1)?.time}`;
  const times = useMemo(
    () => Array.from(new Set(data.map((candle) => candle.time))).sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timesKey],
  );

  useEffect(() => {
    primitiveRef.current?.update({ editable, plans: plans ?? [], selectedId: selectedId ?? null, times });
  }, [editable, enabled, plans, selectedId, times]);

  useEffect(() => {
    const container = containerRef.current;
    if (!editable || !container) return;
    let drag: DragState | null = null;
    let press: { x: number; y: number } | null = null;

    const local = (event: { clientX: number; clientY: number }) => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const toPoint = (x: number, y: number): TradePlanPoint | null => {
      const primitive = primitiveRef.current;
      const t = primitive?.xToTime(x) ?? null;
      const price = primitive?.yToPrice(y) ?? null;
      return t === null || price === null ? null : { price, t };
    };
    const insidePane = (x: number, y: number) => {
      const timeScale = chartRef.current?.timeScale();
      return Boolean(timeScale) && x <= timeScale!.width() && y <= container.clientHeight - timeScale!.height();
    };

    const move = (event: PointerEvent) => {
      const primitive = primitiveRef.current;
      if (!drag || !primitive) return;
      const { x, y } = local(event);
      const to = toPoint(x, y);
      if (!to) return;
      drag.draft = tradePlan.drag(drag.origin, drag.handle, drag.from, to, primitive.stepMs());
      primitive.update({ draft: drag.draft });
    };
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      container.style.cursor = "";
      if (!drag) return;
      const { draft } = drag;
      drag = null;
      const next = (latest.current.plans ?? []).map((plan) => (plan.id === draft.id ? draft : plan));
      primitiveRef.current?.update({ draft: null, plans: next });
      latest.current.onChange?.(next);
    };

    const down = (event: PointerEvent) => {
      const primitive = primitiveRef.current;
      if (!primitive || event.button !== 0) return;
      const { x, y } = local(event);
      if (!insidePane(x, y)) return;
      const hit = primitive.pick(x, y);
      const from = hit && toPoint(x, y);
      if (!hit || !from) {
        press = { x, y };
        return;
      }
      press = null;
      event.preventDefault();
      event.stopPropagation();
      drag = { draft: hit.plan, from, handle: hit.handle, origin: hit.plan };
      container.style.cursor = primitive.hitTest(x, y)?.cursorStyle ?? "grabbing";
      latest.current.onSelect?.(hit.plan.id);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };
    // lightweight-charts pans on mouse/touch events, which still fire after
    // our pointerdown — swallow them while a plan is grabbed.
    const shield = (event: Event) => {
      if (drag) event.stopPropagation();
    };
    const click = (event: PointerEvent) => {
      if (!press) return;
      const { x, y } = local(event);
      const clicked = Math.hypot(x - press.x, y - press.y) < CLICK_SLOP_PX;
      press = null;
      if (!clicked) return;
      const current = latest.current;
      const primitive = primitiveRef.current;
      const point = toPoint(x, y);
      if (current.placing && current.onPlace && primitive && point) {
        current.onPlace({ ...point, t: primitive.snapTime(point.t) }, primitive.stepMs());
      } else current.onSelect?.(null);
    };

    container.addEventListener("pointerdown", down, true);
    container.addEventListener("mousedown", shield, true);
    container.addEventListener("touchstart", shield, true);
    container.addEventListener("pointerup", click);
    // eslint-disable-next-line consistent-return
    return () => {
      release();
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("mousedown", shield, true);
      container.removeEventListener("touchstart", shield, true);
      container.removeEventListener("pointerup", click);
    };
  }, [chartRef, containerRef, editable]);
}
