import type { RuntimeContext } from "@/lib/precision/types";
import type { Position } from "@/lib/system/trading";
import both from "../both";
import type { StrategyAPI } from "../types";

/** Rejects an averaging step beyond an account's configured handoff level. */
async function findAveraging(context: RuntimeContext, position: Position) {
  const decision = await both.decisions!.averaging!.find(context, position);
  if (!decision) return null;

  const maxLevel = context.helper.getAccountConfig(
    position.account,
  ).maxEntryAbsLevel;
  if (
    typeof maxLevel === "number" &&
    Number.isFinite(maxLevel) &&
    Math.abs(decision.recommendation.lvl) > Math.max(0, Math.floor(maxLevel))
  ) {
    return null;
  }

  return decision;
}

const boundedCover: StrategyAPI = {
  ...both,
  name: "custom_gpt6_astra_bounded_cover_v1",
  decisions: {
    ...both.decisions,
    averaging: { find: findAveraging },
  },
};

export default boundedCover;
