import type {
  RuntimeContext,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";
import type { StrategyAPI } from "../types";

import featureGateV1 from "./feature_gate_streak_v1";
import streak from "../streak";
import streakEntry from "../streak/entry";
import streakGateExit from "./exit";

/**
 * `streak` composed with FEATURE GATE V1 — every produced candidate is
 * filtered through `featureGateV1` before the engine sees it: single
 * role re-entries on their own `entrySignal`, atomic `pairEntry`s per
 * leg (one refused leg vetoes the whole pair — legs cannot partially
 * fill). Manual entries keep streak's `shape` and bypass the gate,
 * matching the forced-entry contract. Averaging, guard, `onActionResult`,
 * preflight, and pair diagnostics are streak's own — the gate constrains
 * which produced entries may fill, and the exit keeps the rail while
 * leaving TP%/SL+ armed on pair legs (see `./exit`).
 */
function passes(
  context: RuntimeContext,
  candidate: RuntimeEntryCandidate,
): boolean {
  if (candidate.type === "pairEntry") {
    return candidate.legs.every(
      (leg) =>
        featureGateV1(
          context.state.currentTime,
          context.state.features,
          { ...leg.entrySignal, symbol: leg.symbol },
        ) === undefined,
    );
  }
  return (
    featureGateV1(
      context.state.currentTime,
      context.state.features,
      { ...candidate.entrySignal, symbol: candidate.symbol },
    ) === undefined
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
    exit: { find: streakGateExit.find },
  },
  diagnostics: {
    ...streak.diagnostics,
    explain: (params) => {
      const { accountSlug, context, decision, symbol } = params;
      if (decision) {
        // The scan decision is a raw signal (no pair meta) — but a pair
        // emits one MAIN + one COUNTER leg sharing it, so probe the gate
        // per role the account emits; any refusal vetoes the candidate.
        const legs =
          context.helper.getAccountConfig(accountSlug).entryLegs ?? "BOTH";
        const roles = legs === "BOTH" ? (["MAIN", "COUNTER"] as const) : [legs];
        for (const role of roles) {
          const reason = featureGateV1(
            context.state.currentTime,
            context.state.features,
            { ...decision.entrySignal, symbol },
          );
          if (reason) {
            return {
              code: "FEATURE_GATE",
              reason: `Blocked by the feature gate (${role} leg): ${reason}.`,
              status: "blocked",
            };
          }
        }
      }
      return streak.diagnostics?.explain?.(params);
    },
  },
};

export default streakWithFeatureGate;
