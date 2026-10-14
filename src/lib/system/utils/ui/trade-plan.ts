/**
 * Visual-only trade plans drawn on a chart (TradingView "long/short
 * position" style): when entry may happen, the entry price, a take-profit
 * ladder, the stop loss, and a timeout. Nothing here places orders or feeds
 * the engine. Pure; no I/O.
 */
import type { Position } from "@/lib/system/trading/types";

export type TradePlanSide = "LONG" | "SHORT";

/** One drawn plan. Times are ms, prices in quote currency. */
export interface TradePlan {
  id: string;
  side: TradePlanSide;
  /** Earliest entry time, ms — the box's left edge. */
  t: number;
  /** Timeout, ms — the box's right edge; the plan is void after it. */
  end: number;
  entry: number;
  sl: number;
  /** Take-profit ladder, TP1 first. */
  tp: number[];
}

/** Part of a plan a pointer can grab. */
export type TradePlanHandle =
  | { kind: "entry" }
  | { kind: "sl" }
  | { kind: "tp"; index: number }
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "body" };

/** Pointer position in plan units (ms, price). */
export interface TradePlanPoint {
  t: number;
  price: number;
}

const DEFAULT_RISK_PCT = 1;
const DEFAULT_BARS = 24;

/** Short random id, unique enough for one browser's drawings. */
function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** +1 when price above entry is in the plan's favor, −1 otherwise. */
function sign(side: TradePlanSide): 1 | -1 {
  return side === "LONG" ? 1 : -1;
}

/**
 * New plan at `price`: SL 1% against, TP1/TP2 at 1R/2R, timeout
 * `DEFAULT_BARS` bars after `t`.
 */
function create({
  side,
  price,
  t,
  stepMs,
}: {
  side: TradePlanSide;
  price: number;
  t: number;
  stepMs: number;
}): TradePlan {
  const risk = (price * DEFAULT_RISK_PCT * sign(side)) / 100;
  return {
    end: t + DEFAULT_BARS * stepMs,
    entry: price,
    id: newId(),
    side,
    sl: price - risk,
    t,
    tp: [price + risk, price + 2 * risk],
  };
}

/** Signed move from entry to `price` in the plan's favor, percent. */
function pct(plan: TradePlan, price: number): number {
  return ((price - plan.entry) / plan.entry) * 100 * sign(plan.side);
}

/** Reward-to-risk of reaching `price`; undefined while the SL sits on the wrong side. */
function rr(plan: TradePlan, price: number): number | undefined {
  const risk = -pct(plan, plan.sl);
  return risk > 0 ? pct(plan, price) / risk : undefined;
}

/** Mirrors every level around the entry and swaps the side. */
function flip(plan: TradePlan): TradePlan {
  const mirror = (price: number) => 2 * plan.entry - price;
  return {
    ...plan,
    side: plan.side === "LONG" ? "SHORT" : "LONG",
    sl: mirror(plan.sl),
    tp: plan.tp.map(mirror),
  };
}

/** Appends a TP one rung beyond the last (same spacing as the previous rung). */
function addTp(plan: TradePlan): TradePlan {
  const last = plan.tp.at(-1) ?? plan.entry;
  const previous = plan.tp.at(-2) ?? plan.entry;
  const gap = last - previous || plan.entry - plan.sl;
  return { ...plan, tp: [...plan.tp, last + gap] };
}

/** Drops one TP, always keeping at least one. */
function removeTp(plan: TradePlan, index: number): TradePlan {
  if (plan.tp.length <= 1) return plan;
  return { ...plan, tp: plan.tp.filter((_, i) => i !== index) };
}

/**
 * Plan after dragging `handle` from `from` to `to`, applied to the plan as
 * it was at grab time so repeated moves never accumulate rounding. Time
 * moves are snapped to whole bars and the box keeps at least one bar.
 */
function drag(
  origin: TradePlan,
  handle: TradePlanHandle,
  from: TradePlanPoint,
  to: TradePlanPoint,
  stepMs: number,
): TradePlan {
  const dPrice = to.price - from.price;
  const dt = Math.round((to.t - from.t) / stepMs) * stepMs;
  switch (handle.kind) {
    case "entry":
      return { ...origin, entry: origin.entry + dPrice };
    case "sl":
      return { ...origin, sl: origin.sl + dPrice };
    case "tp":
      return {
        ...origin,
        tp: origin.tp.map((price, i) => (i === handle.index ? price + dPrice : price)),
      };
    case "start":
      return { ...origin, t: Math.min(origin.t + dt, origin.end - stepMs) };
    case "end":
      return { ...origin, end: Math.max(origin.end + dt, origin.t + stepMs) };
    default:
      // "body" — the whole box moves in time and price.
      return {
        ...origin,
        end: origin.end + dt,
        entry: origin.entry + dPrice,
        sl: origin.sl + dPrice,
        t: origin.t + dt,
        tp: origin.tp.map((price) => price + dPrice),
      };
  }
}

/** "45m", "6h", "2d 4h" — compact span for the timeout label. */
function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/**
 * Read-only chart plan for a position's `strategy.plan`: entry at the fill,
 * box from the open to the timeout, else the close, else `now`. Undefined
 * unless the plan has both a TP and an SL price.
 */
function fromPosition(
  position: Pick<Position, "opened" | "strategy"> & Partial<Pick<Position, "direction" | "closed">>,
  now: number,
): TradePlan | undefined {
  const plan = position.strategy?.plan;
  const entry = position.opened.price;
  if (plan?.tp === undefined || plan.sl === undefined || !(entry > 0)) return undefined;
  const side = position.direction ?? (plan.tp >= entry ? "LONG" : "SHORT");
  return {
    end: plan.exp ?? position.closed?.t ?? now,
    entry,
    id: `position:${position.opened.t}`,
    side,
    sl: plan.sl,
    t: position.opened.t,
    tp: [plan.tp],
  };
}

/** Plans parsed from untrusted storage; malformed entries are dropped. */
function sanitize(raw: unknown): TradePlan[] {
  if (!Array.isArray(raw)) return [];
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  return raw.filter(
    (plan): plan is TradePlan =>
      typeof plan?.id === "string" &&
      (plan.side === "LONG" || plan.side === "SHORT") &&
      finite(plan.t) &&
      finite(plan.end) &&
      finite(plan.entry) &&
      plan.entry > 0 &&
      finite(plan.sl) &&
      Array.isArray(plan.tp) &&
      plan.tp.length > 0 &&
      plan.tp.every(finite),
  );
}

const tradePlan = {
  addTp,
  create,
  drag,
  flip,
  formatSpan,
  fromPosition,
  pct,
  removeTp,
  rr,
  sanitize,
} as const;

export default tradePlan;
