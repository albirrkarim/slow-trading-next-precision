import defaultDecision from "@/lib/precision/defaultDecision";
import type { StrategyAPI } from "../types";
import featureGate from "./features";

const defaultWithFeaturesGate: StrategyAPI = {
  name: "default_with_features_gate",
  decisions: {
    entry: {
      find: async (context) => {
        const candidates = await defaultDecision.entry.find(context);
        return candidates.filter(
          (candidate) =>
            featureGate(
              context,
              candidate.symbol,
              candidate.type === "entry" ? candidate.entrySignal : undefined,
            ) === undefined,
        );
      },
    },
  },
  diagnostics: {
    explain: ({ context, symbol, decision }) => {
      if (!decision) return undefined;
      const reason = featureGate(context, symbol, decision.entrySignal);
      if (!reason) return undefined;
      return {
        code: "FEATURE_GATE",
        reason: `Blocked by the feature gate: ${reason}.`,
        status: "blocked",
      };
    },
  },
};

export default defaultWithFeaturesGate;
