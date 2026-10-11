import type { StrategyAPI } from "../types";
import humanEntry, { HUMAN_V1_MIN_EMA_DISTANCE_PCT } from "./entry";
import humanExit from "./exit";
import humanSignal from "./signal";
import humanState from "./state";

/**
 * human_v1 — trend following on configured indicators, no vPoints:
 * enter when price crosses the first enabled EMA, then clears it by at
 * least 1% in the direction every Supertrend agrees on; exit on any shared
 * exit rule or when price crosses that EMA back. Never averages.
 */
const humanV1: StrategyAPI = {
  name: "human_v1",
  decisions: {
    entry: { find: humanEntry.find },
    // BOTH:HUMAN_V1_NO_AVERAGING
    averaging: { find: async () => null },
    exit: { find: humanExit.find },
  },
  diagnostics: {
    explain: ({ context, symbol }) => {
      const coin = symbol.toUpperCase();
      const reading = humanSignal.read(
        context.state.features,
        coin,
        context.state.markPriceMap[coin]?.price,
      );
      const blocked = (reason: string) => ({ code: "HUMAN_V1", reason, status: "blocked" as const });
      if (reading.missing) return blocked(`human_v1: ${reading.missing}`);
      if (reading.consensus === undefined) {
        return blocked(`human_v1: Supertrends disagree (${reading.supertrendIds.join(", ")})`);
      }
      const trend = reading.consensus === 1 ? "up" : "down";
      if (reading.side !== reading.consensus) {
        return blocked(`human_v1: Supertrends ${trend}, price on the other side of ${reading.emaId}`);
      }
      const state = humanState.peek(context);
      const previous = state.side[coin];
      // A side flip arms on the next pass even before it is recorded.
      const armed =
        state.armed[coin] === reading.side ||
        (previous !== undefined && previous !== reading.side);
      if (!armed) {
        return blocked(`human_v1: Supertrends ${trend} and price beyond ${reading.emaId}; waiting for a fresh cross`);
      }
      const distance = (reading.side as number) * (reading.distancePct as number);
      return distance >= HUMAN_V1_MIN_EMA_DISTANCE_PCT
        ? {
            code: "HUMAN_V1",
            reason: `human_v1: ${reading.emaId} cross with Supertrends ${trend}, ${distance.toFixed(2)}% beyond`,
            status: "ready",
          }
        : blocked(
            `human_v1: ${reading.emaId} cross armed with Supertrends ${trend}; ` +
              `price ${distance.toFixed(2)}% beyond, needs ${HUMAN_V1_MIN_EMA_DISTANCE_PCT}%`,
          );
    },
  },
};

export default humanV1;
