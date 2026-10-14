import type { PositionCloseReason, PositionDirection, PositionPlan } from "./types";

export interface PlanExitHit {
  reason: Extract<PositionCloseReason, "PLAN_TP" | "PLAN_SL" | "PLAN_TIMEOUT">;
  /** The plan level that was reached: a price for TP/SL, the ms deadline for a timeout. */
  level: number;
}

/**
 * Plan with only usable levels kept — prices and timeout must be finite
 * and positive. Undefined when nothing usable remains, so positions never
 * persist an empty `plan` object.
 */
function normalize(plan: PositionPlan | undefined): PositionPlan | undefined {
  if (!plan) return undefined;
  const usable = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const next: PositionPlan = {};
  if (usable(plan.tp)) next.tp = plan.tp;
  if (usable(plan.sl)) next.sl = plan.sl;
  if (usable(plan.exp)) next.exp = plan.exp;
  return Object.keys(next).length ? next : undefined;
}

/**
 * First plan level the mark has reached, checked SL → TP → timeout so a
 * mis-ordered plan never books a loss as a take profit. LONG: mark ≤ sl /
 * mark ≥ tp; SHORT mirrors it. The timeout fires once `t` reaches `exp`.
 */
function evaluate({
  plan,
  direction,
  price,
  t,
}: {
  plan: PositionPlan | undefined;
  direction: PositionDirection;
  price: number;
  t: number;
}): PlanExitHit | null {
  const levels = normalize(plan);
  if (!levels || !Number.isFinite(price) || price <= 0) return null;
  const isLong = direction !== "SHORT";
  if (levels.sl !== undefined && (isLong ? price <= levels.sl : price >= levels.sl)) {
    return { level: levels.sl, reason: "PLAN_SL" };
  }
  if (levels.tp !== undefined && (isLong ? price >= levels.tp : price <= levels.tp)) {
    return { level: levels.tp, reason: "PLAN_TP" };
  }
  if (levels.exp !== undefined && t >= levels.exp) {
    return { level: levels.exp, reason: "PLAN_TIMEOUT" };
  }
  return null;
}

const planExit = { evaluate, normalize } as const;

export default planExit;
