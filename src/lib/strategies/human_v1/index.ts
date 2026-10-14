import type { StrategyAPI } from "../types";
import humanEntry from "./entry";
import humanSetup from "./setup";
import humanSignal from "./signal";
import humanState from "./state";

/**
 * human_v1 — Supertrend alignment on configured indicators, no vPoints:
 * enter when every Supertrend flipped the same way at nearly the same time
 * while price is above the first enabled EMA. Exits come from the entry's
 * plan (TP/SL at EMA and monthly VWAP σ bands) plus every shared exit
 * rule, through the default exit producer. Never averages.
 */
const humanV1: StrategyAPI = {
  name: "human_v1",
  decisions: {
    entry: { find: humanEntry.find },
    // BOTH:HUMAN_V1_NO_AVERAGING
    averaging: { find: async () => null },
  },
  diagnostics: {
    explain: ({ context, symbol }) => {
      const coin = symbol.toUpperCase();
      const reading = humanSignal.read(
        context.state.features,
        coin,
        context.state.markPriceMap[coin]?.price,
      );
      const result = humanSetup.evaluate(reading, context.state.currentTime);
      if (!("setup" in result)) {
        return { code: "HUMAN_V1", reason: `human_v1: ${result.reason}`, status: "blocked" };
      }
      const { setup } = result;
      if (humanState.peek(context).used[coin] === setup.flipT) {
        return { code: "HUMAN_V1", reason: "human_v1: this Supertrend alignment was already traded", status: "blocked" };
      }
      return {
        code: "HUMAN_V1",
        reason: `human_v1: ${setup.direction === 1 ? "LONG" : "SHORT"} setup, TP ${setup.plan.tp} · SL ${setup.plan.sl}`,
        status: "ready",
      };
    },
  },
};

export default humanV1;
