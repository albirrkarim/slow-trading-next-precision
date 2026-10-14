/**
 * Series primitive that draws visual-only trade plans (entry, TP ladder,
 * SL, entry time → timeout box) and resolves which part of a plan sits
 * under the pointer. Follows the lightweight-charts v5 primitive contract.
 */
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

import tradePlan, { type TradePlan, type TradePlanHandle } from "@/lib/system/utils/ui/trade-plan";

const ENTRY_COLOR = "#78909c";
const TP_COLOR = "#26a69a";
const SL_COLOR = "#ef5350";
const PROFIT_FILL = "rgba(38, 166, 154, 0.16)";
const LOSS_FILL = "rgba(239, 83, 80, 0.16)";
const HIT_TOLERANCE_PX = 6;
const HANDLE_PX = 8;
const LABEL_FONT = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const CURSOR: Record<TradePlanHandle["kind"], string> = {
  body: "move",
  end: "ew-resize",
  entry: "ns-resize",
  sl: "ns-resize",
  start: "ew-resize",
  tp: "ns-resize",
};

interface PlanGeometry {
  left: number;
  right: number;
  yEntry: number;
  ySl: number;
  yTp: number[];
}

export interface TradePlanHit {
  plan: TradePlan;
  handle: TradePlanHandle;
}

/** Index of the last time ≤ `t` in ascending `times` (binary search). */
function floorIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class TradePlanPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private plans: TradePlan[] = [];
  private selectedId: string | null = null;
  /** Candle open times, chart seconds, ascending. */
  private times: number[] = [];
  private stepSec = 60;
  /** In-flight drag result, drawn in place of the stored plan with its id. */
  private draft: TradePlan | null = null;
  /** Draggable: shows the time handles and drag cursors. */
  private editable = true;
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private readonly views: IPrimitivePaneView[] = [
    { renderer: () => this.renderer, zOrder: () => "top" },
  ];
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => this.draw(target),
  };

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart as IChartApi;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  update(state: {
    plans?: TradePlan[];
    selectedId?: string | null;
    times?: number[];
    draft?: TradePlan | null;
    editable?: boolean;
  }): void {
    if (state.plans) this.plans = state.plans;
    if (state.editable !== undefined) this.editable = state.editable;
    if (state.selectedId !== undefined) this.selectedId = state.selectedId;
    if (state.draft !== undefined) this.draft = state.draft;
    if (state.times) {
      this.times = state.times;
      this.stepSec = this.estimateStep();
    }
    this.requestUpdate?.();
  }

  /** Bar spacing, ms — the smallest gap among the newest candles. */
  stepMs(): number {
    return this.stepSec * 1000;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  updateAllViews(): void {
    this.axisViews = this.buildAxisViews();
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.editable ? this.pick(x, y) : null;
    if (!hit) return null;
    return { cursorStyle: CURSOR[hit.handle.kind], externalId: hit.plan.id, zOrder: "top" };
  }

  /** Plan part under the pane point (x, y), selected plan first. */
  pick(x: number, y: number): TradePlanHit | null {
    const plans = this.visiblePlans().reverse();
    plans.sort((a, b) => Number(b.id === this.selectedId) - Number(a.id === this.selectedId));
    for (const plan of plans) {
      const g = this.layout(plan);
      if (!g || x < g.left - HIT_TOLERANCE_PX || x > g.right + HIT_TOLERANCE_PX) continue;
      const near = (level: number) => Math.abs(y - level) <= HIT_TOLERANCE_PX;
      if (near(g.yEntry) && Math.abs(x - g.left) <= HIT_TOLERANCE_PX) return { handle: { kind: "start" }, plan };
      if (near(g.yEntry) && Math.abs(x - g.right) <= HIT_TOLERANCE_PX) return { handle: { kind: "end" }, plan };
      if (near(g.ySl)) return { handle: { kind: "sl" }, plan };
      const tpIndex = g.yTp.findIndex(near);
      if (tpIndex >= 0) return { handle: { index: tpIndex, kind: "tp" }, plan };
      if (near(g.yEntry)) return { handle: { kind: "entry" }, plan };
      const ys = [g.yEntry, g.ySl, ...g.yTp];
      if (x >= g.left && x <= g.right && y >= Math.min(...ys) && y <= Math.max(...ys)) {
        return { handle: { kind: "body" }, plan };
      }
    }
    return null;
  }

  /** Pane x → chart time, ms; extrapolates past either end of the data. */
  xToTime(x: number): number | null {
    const logical = this.chart?.timeScale().coordinateToLogical(x);
    const { times, stepSec } = this;
    const n = times.length;
    if (logical == null || !n) return null;
    if (logical <= 0) return (times[0] + logical * stepSec) * 1000;
    if (logical >= n - 1) return (times[n - 1] + (logical - (n - 1)) * stepSec) * 1000;
    const i = Math.floor(logical);
    return (times[i] + (logical - i) * (times[i + 1] - times[i])) * 1000;
  }

  /** Rounds `ms` to the nearest bar open time on the newest bar's grid. */
  snapTime(ms: number): number {
    const last = (this.times.at(-1) ?? 0) * 1000;
    const step = this.stepMs();
    return last + Math.round((ms - last) / step) * step;
  }

  /** Pane y → price. */
  yToPrice(y: number): number | null {
    return this.series?.coordinateToPrice(y) ?? null;
  }

  private estimateStep(): number {
    const { times } = this;
    let step = Infinity;
    for (let i = Math.max(1, times.length - 20); i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      if (gap > 0 && gap < step) step = gap;
    }
    return Number.isFinite(step) ? step : 60;
  }

  /** Chart time (ms) → pane x; extrapolates past either end of the data. */
  private timeToX(ms: number): number | null {
    const { times, stepSec } = this;
    const n = times.length;
    if (!this.chart || !n) return null;
    const t = ms / 1000;
    let logical: number;
    if (t <= times[0]) logical = (t - times[0]) / stepSec;
    else if (t >= times[n - 1]) logical = n - 1 + (t - times[n - 1]) / stepSec;
    else {
      const i = floorIndex(times, t);
      logical = i + (t - times[i]) / (times[i + 1] - times[i]);
    }
    return this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  private visiblePlans(): TradePlan[] {
    const { draft } = this;
    return this.plans.map((plan) => (draft && draft.id === plan.id ? draft : plan));
  }

  private layout(plan: TradePlan): PlanGeometry | null {
    const series = this.series;
    const x1 = this.timeToX(plan.t);
    const x2 = this.timeToX(plan.end);
    if (!series || x1 === null || x2 === null) return null;
    const y = (price: number) => series.priceToCoordinate(price);
    const yEntry = y(plan.entry);
    const ySl = y(plan.sl);
    const yTp = plan.tp.map(y);
    if (yEntry === null || ySl === null || yTp.some((value) => value === null)) return null;
    return { left: Math.min(x1, x2), right: Math.max(x1, x2), yEntry, ySl, yTp: yTp as number[] };
  }

  private format(price: number): string {
    return this.series?.priceFormatter().format(price) ?? String(price);
  }

  private buildAxisViews(): ISeriesPrimitiveAxisView[] {
    const plan = this.visiblePlans().find((item) => item.id === this.selectedId);
    const series = this.series;
    if (!plan || !series) return [];
    const levels: { price: number; color: string }[] = [
      { color: ENTRY_COLOR, price: plan.entry },
      { color: SL_COLOR, price: plan.sl },
      ...plan.tp.map((price) => ({ color: TP_COLOR, price })),
    ];
    return levels.map(({ price, color }) => ({
      backColor: () => color,
      coordinate: () => series.priceToCoordinate(price) ?? -100,
      text: () => this.format(price),
      textColor: () => "#ffffff",
    }));
  }

  private draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.font = LABEL_FONT;
      ctx.textBaseline = "middle";
      for (const plan of this.visiblePlans()) {
        const g = this.layout(plan);
        if (g) this.drawPlan(ctx, plan, g, plan.id === this.selectedId);
      }
    });
  }

  private drawPlan(ctx: CanvasRenderingContext2D, plan: TradePlan, g: PlanGeometry, selected: boolean): void {
    const width = Math.max(1, g.right - g.left);
    const yFar = g.yTp.reduce((far, y) => (Math.abs(y - g.yEntry) > Math.abs(far - g.yEntry) ? y : far), g.yEntry);

    ctx.fillStyle = PROFIT_FILL;
    ctx.fillRect(g.left, Math.min(g.yEntry, yFar), width, Math.abs(yFar - g.yEntry));
    ctx.fillStyle = LOSS_FILL;
    ctx.fillRect(g.left, Math.min(g.yEntry, g.ySl), width, Math.abs(g.ySl - g.yEntry));

    const lineWidth = selected ? 2 : 1;
    const line = (y: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(g.left, y);
      ctx.lineTo(g.right, y);
      ctx.stroke();
    };
    line(g.ySl, SL_COLOR);
    g.yTp.forEach((y) => line(y, TP_COLOR));
    line(g.yEntry, ENTRY_COLOR);

    const pctText = (price: number) => {
      const value = tradePlan.pct(plan, price);
      return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
    };
    const span = tradePlan.formatSpan(plan.end - plan.t);
    this.label(ctx, `${plan.side} ${this.format(plan.entry)} · ⏱ ${span}`, g.left, g.yEntry, ENTRY_COLOR);
    this.label(ctx, `SL ${this.format(plan.sl)} ${pctText(plan.sl)}`, g.left, g.ySl, SL_COLOR);
    plan.tp.forEach((price, i) => {
      const ratio = tradePlan.rr(plan, price);
      const rrText = ratio === undefined ? "" : ` ${ratio.toFixed(2)}R`;
      this.label(ctx, `TP${i + 1} ${this.format(price)} ${pctText(price)}${rrText}`, g.left, g.yTp[i], TP_COLOR);
    });

    if (selected && this.editable) {
      this.handle(ctx, g.left, g.yEntry, ENTRY_COLOR);
      this.handle(ctx, g.right, g.yEntry, ENTRY_COLOR);
    }
  }

  /** Pill label centered on the level, just inside the box's left edge. */
  private label(ctx: CanvasRenderingContext2D, text: string, left: number, y: number, color: string): void {
    const padding = 4;
    const height = 16;
    const width = ctx.measureText(text).width + padding * 2;
    const x = left + HANDLE_PX;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y - height / 2, width, height, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x + padding, y + 0.5);
  }

  private handle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    ctx.strokeRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
  }
}
