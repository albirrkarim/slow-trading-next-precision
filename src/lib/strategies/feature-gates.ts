import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

import featureGateV1 from "./default_with_features_gate/features/v1/feature_gate_v1";
import featureGateV2 from "./default_with_features_gate/features/v2/feature_gate_v2";
import featureGateV4, { subGates as v4SubGates } from "./default_with_features_gate/features/v4";
import featureGateV5, { defaultSubGates as v5DefaultSubGates, subGates as v5SubGates } from "./default_with_features_gate/features/v5";
import featureGateStreakV1 from "./streak_with_feature_gate/feature_gate_streak_v1";

/** Gate decision and its explanation, including why an entry was allowed. */
export interface FeatureGateResult {
  allow: boolean;
  message: string;
}

/** Pure gate inputs, shared by backtest, live/sandbox, and dataset inference. */
export type FeatureGate = (
  currentTime: number,
  features: RuntimeFeatures | undefined,
  signal: VolatilityPoint,
) => FeatureGateResult;

/** Each engine or dataset evaluation owns and releases its prepared resources. */
export interface FeatureGateSession {
  gate: FeatureGate;
  dispose: () => void;
}

type FeatureGateEntry = { label: string; subGates?: Record<string, string>; defaultSubGates?: readonly string[] } & (
  { gate: FeatureGate; prepare?: never } |
  { prepare: () => Promise<FeatureGateSession>; gate?: never }
);

/**
 * Versioned gate catalog across strategies — the slug selects the rule set
 * for dataset evaluation (`/api/dev/feature-gate/*`) while each strategy's
 * own default export keeps pointing at its production version.
 */
export const FEATURE_GATE_REGISTRY = {
  streak_v1: {
    gate: featureGateStreakV1,
    label: "streak v1 — priceNormalized bounds + BTC recovery veto",
  },
  v1: {
    gate: featureGateV1,
    label: "v1 — priceNormalized envelope zones",
  },
  v2: {
    gate: featureGateV2,
    label: "v2 — monthly VWAP σ + regimes",
  },
  v3: {
    label: "v3 — neural miss-score risk gate",
    prepare: async () => (await import("./default_with_features_gate/features/v3")).default.load(),
  },
  v4: {
    gate: featureGateV4,
    label: "v4 — monthly VWAP + sideways regime checks",
    subGates: v4SubGates,
  },
  v5: {
    gate: featureGateV5,
    label: "v5 — VWAP + sideways checks; optional BTC movement experiments",
    subGates: v5SubGates,
    defaultSubGates: v5DefaultSubGates,
  },
} as const satisfies Record<string, FeatureGateEntry>;

export type FeatureGateSlug = keyof typeof FEATURE_GATE_REGISTRY;
