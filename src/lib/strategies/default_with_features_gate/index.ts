import defaultDecision from "@/lib/precision/defaultDecision";
import type { StrategyAPI } from "../types";
import featureGate from "./features";

const defaultWithFeaturesGate: StrategyAPI = {
  name: "default_with_features_gate",
  warmup: featureGate.warmup,
  dispose: featureGate.dispose,
  decisions: {
    entry: {
      find: async (context) => {
        const candidates = await defaultDecision.entry.find(context);
        return candidates.filter(
          (candidate) =>
            featureGate.gate(
              context,
              { ...candidate.entrySignal, symbol: candidate.symbol },
            ) === undefined,
        );
      },
    },
  },
  diagnostics: {
    explain: ({ context, symbol, decision }) => {
      if (!decision) return undefined;
      const reason = featureGate.gate(context, {
        ...decision.entrySignal,
        symbol,
      });
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
