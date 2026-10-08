import type { VolatilityPoint } from "@/lib/system/types/market";
import type { RuntimeFeatures } from "@/lib/features/types";
import { FEATURE_GATE_BOUNDS } from "../v1/feature_gate_v1";

const keys = ["B0", "B1", "B2", "B3", "T0", "T1", "T2", "T3"] as const;
const hierarchicalKeys = ["B", "T"].flatMap((side) => ["", "0", "1", "2+", "2", "3+"].flatMap((level) => ["", "L", "M", "H"].map((regime) => `${side}${level}${regime}`)));

/** Fixed causal partitions: direction and absolute level, with levels >=3 pooled. */
function key(signal: VolatilityPoint): string {
  return `${signal.l}${Math.min(3, Math.abs(signal.lvl))}`;
}

/** Most-specific-first fallbacks based on direction, level and BTC's visible normalized-range regime. */
function path(signal: VolatilityPoint, features: RuntimeFeatures | undefined, profile?: "side-level" | "hierarchical"): string[] {
  if (profile !== "hierarchical") return [key(signal)];
  const side = signal.l;
  const level = Math.abs(signal.lvl);
  const parent = `${side}${Math.min(2, level)}${level >= 2 ? "+" : ""}`;
  const leaf = `${side}${Math.min(3, level)}${level >= 3 ? "+" : ""}`;
  const norm = features?.coins.BTC?.priceNormalized?.current;
  const regime = typeof norm === "number" && Number.isFinite(norm)
    ? norm < FEATURE_GATE_BOUNDS.btcMinPriceNormalized ? "L" : norm > FEATURE_GATE_BOUNDS.btcMaxPriceNormalized ? "H" : "M" : undefined;
  return [...new Set(regime ? [leaf + regime, leaf, parent + regime, parent, side + regime, side] : [leaf, parent, side])];
}

/** Uses the most specific supported partition; older artifacts keep their single cutoff. */
function resolve(threshold: number, cutoffs: Record<string, number> | undefined, signal: VolatilityPoint, features: RuntimeFeatures | undefined, profile?: "side-level" | "hierarchical"): { threshold: number; group: string } {
  const groups = path(signal, features, profile);
  const group = groups.find((value) => cutoffs?.[value] !== undefined);
  return { threshold: group ? cutoffs![group] : threshold, group: group ?? "global" };
}

const cutoff = { keys, hierarchicalKeys, key, path, resolve } as const;
export default cutoff;
