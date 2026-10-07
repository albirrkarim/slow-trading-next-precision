import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

import featureGateV1 from "./default_with_features_gate/features/feature_gate_v1";
import featureGateV2 from "./default_with_features_gate/features/v2/feature_gate_v2";
import featureGateStreakV1 from "./streak_with_feature_gate/feature_gate_streak_v1";

/** Pure gate inputs, shared by backtest, live/sandbox, and dataset inference. */
export type FeatureGate = (
  currentTime: number,
  features: RuntimeFeatures | undefined,
  signal: VolatilityPoint,
) => string | undefined;

/** Each engine or dataset evaluation owns and releases its prepared resources. */
export interface FeatureGateSession {
  gate: FeatureGate;
  dispose: () => void;
}

type FeatureGateEntry = { label: string } & (
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
} as const satisfies Record<string, FeatureGateEntry>;

export type FeatureGateSlug = keyof typeof FEATURE_GATE_REGISTRY;
