import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

import v1 from "../feature_gate_v1";
import v2, { FEATURE_GATE_VWAP_BOUNDS, } from "../v2/feature_gate_v2";
import regimes, { FEATURE_GATE_REGIME_BOUNDS } from "../v2/feature_gate_regimes";
import { closeToExtreme, isCurrentExtreme } from "../v2/feature_gate_price_norm";

/** Existing gate policies or their unchanged extreme-range vetoes; evaluated only with capture-time inputs. */
const HARD_RULES = ["v1", "v2", "v2-regimes", "v2-current-range", "v2-overstretched", "v2-quiet-overstretched", "v2-quiet-overstretched-low-level", "v1-btc-extended", "min-level-2", "min-level-3"] as const;
export type NeuralHardRule = typeof HARD_RULES[number];

/** Returns the first hard veto after neural acceptance. No outcome or future sequence enters these checks. */
function rejection(policy: readonly NeuralHardRule[], t: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint): string | undefined {

  if (closeToExtreme(features, signal.symbol ?? "", signal.lvl, -2)) {
    return `Too close to extreme`
  }

  if (isCurrentExtreme(features, signal.symbol ?? "")) {
    return `Too much extreme`
  }


  for (const rule of policy) {
    let reason: string | undefined;
    if (rule === "v1" || rule === "v2") {
      const result = (rule === "v1" ? v1 : v2)(t, features, signal);
      if (!result.allow) reason = result.message;
    } else if (rule === "v2-regimes") {
      reason = regimes(t, features, signal);
    } else if (rule === "v2-current-range") {
      const values = [features?.coins.BTC?.priceNormalized?.current,
      features?.coins[(signal.symbol ?? "").toUpperCase()]?.priceNormalized?.current];
      if (values.some((value) => typeof value === "number" && Number.isFinite(value) && (value > 1 || value < 0))) {
        reason = "normalized price is outside the current range [0, 1]";
      }
    } else if (rule === "v2-overstretched" || rule === "v2-quiet-overstretched" || rule === "v2-quiet-overstretched-low-level") {
      const btcStretch = features?.coins.BTC?.vwap?.stretchPct;
      if (rule !== "v2-overstretched" && (typeof btcStretch !== "number" || !Number.isFinite(btcStretch) || btcStretch > FEATURE_GATE_REGIME_BOUNDS.maxBreakdownBtcStretchPct)) continue;
      if (rule === "v2-quiet-overstretched-low-level" && Math.abs(signal.lvl) >= 3) continue;
      const vwap = features?.coins[(signal.symbol ?? "").toUpperCase()]?.vwap;
      if (!vwap || typeof vwap.price !== "number" || !Number.isFinite(vwap.price) || vwap.price <= 0 ||
        typeof vwap.stdev !== "number" || !Number.isFinite(vwap.stdev) || vwap.stdev <= 0) {
        reason = "monthly VWAP or sigma is unavailable";
      } else {
        const distance = Math.abs(signal.p - vwap.price) / vwap.stdev;
        if (distance > FEATURE_GATE_VWAP_BOUNDS.maxSigma) reason = `signal is ${distance.toFixed(3)} sigma from monthly VWAP (> ${FEATURE_GATE_VWAP_BOUNDS.maxSigma})`;
      }
    } else if (rule === "v1-btc-extended") {
      if (Math.abs(signal.lvl) < 3 && (features?.coins.BTC?.priceNormalized?.history ?? []).some((point) => point.p > 0.95)) {
        reason = "BTC normalized-price trail exceeded 0.95 while signal level is below 3";
      }
    } else if (rule === "min-level-2" || rule === "min-level-3") {
      const min = rule === "min-level-2" ? 2 : 3;
      if (!Number.isFinite(signal.lvl) || Math.abs(signal.lvl) < min) reason = `absolute signal level must be at least ${min}`;
    }
    if (reason !== undefined) return `${rule}: ${reason}`;
  }

  return undefined;
}

const hardRules = { names: HARD_RULES, rejection } as const;
export default hardRules;
