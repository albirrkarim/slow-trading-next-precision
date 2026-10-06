import type {
  RuntimeContext,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";
import type { StrategyAPI } from "../types";

import featureGateV1 from "../default_with_features_gate/feature_gate_v1";
import streak from "../streak";
import streakEntry from "../streak/entry";

/**
 * `streak` composed with FEATURE GATE V1 — every produced candidate is
 * filtered through `featureGateV1` before the engine sees it: single
 * role re-entries on their own `entrySignal`, atomic `pairEntry`s per
 * leg (one refused leg vetoes the whole pair — legs cannot partially
 * fill). Manual entries keep streak's `shape` and bypass the gate,
 * matching the forced-entry contract. Averaging, exit, guard,
 * `onActionResult`, preflight, and pair diagnostics are streak's own —
 * the gate only constrains which produced entries may fill.
 */
function passes(
  context: RuntimeContext,
  candidate: RuntimeEntryCandidate,
): boolean {
  if (candidate.type === "pairEntry") {
    return candidate.legs.every(
      (leg) =>
        featureGateV1(context, leg.symbol, leg.entrySignal) === undefined,
    );
  }
  return (
    featureGateV1(context, candidate.symbol, candidate.entrySignal) ===
    undefined
  );
}

const streakWithFeatureGate: StrategyAPI = {
  ...streak,
  name: "streak_with_feature_gate",
  decisions: {
    ...streak.decisions,
    entry: {
      ...streak.decisions?.entry,
      find: async (context) =>
        (await streakEntry.find(context)).filter((candidate) =>
          passes(context, candidate),
        ),
    },
  },
  diagnostics: {
    ...streak.diagnostics,
    explain: (params) => {
      const { context, decision, symbol } = params;
      if (decision) {
        const reason = featureGateV1(context, symbol, decision.entrySignal);
        if (reason) {
          return {
            code: "FEATURE_GATE",
            reason: `Blocked by the feature gate: ${reason}.`,
            status: "blocked",
          };
        }
      }
      return streak.diagnostics?.explain?.(params);
    },
  },
};

export default streakWithFeatureGate;
