import defaultDecision from "@/lib/precision/defaultDecision";
import type { RuntimeEntryDecision } from "@/lib/precision/types";
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
        const accepted: RuntimeEntryDecision[] = [];
        for (const candidate of candidates) {
          // BOTH:FEATURE_GATE_ENTRY_MESSAGE — keep the strategy's acceptance reason through fill/storage.
          const result = featureGate.gate(context, { ...candidate.entrySignal, symbol: candidate.symbol });
          if (result.allow) accepted.push({ ...candidate, message: result.message });
        }
        return accepted;
      },
    },
  },
  diagnostics: {
    explain: ({ context, symbol, decision }) => {
      if (!decision) return undefined;
      const result = featureGate.gate(context, {
        ...decision.entrySignal,
        symbol,
      });
      return {
        code: "FEATURE_GATE",
        reason: result.message,
        status: result.allow ? "ready" : "blocked",
      };
    },
  },
};

export default defaultWithFeaturesGate;
