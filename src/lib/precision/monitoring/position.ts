import { type Position } from "@/lib/trading/models";
import type { RuntimeContext } from "../types";

/**
 * Doing the averaging and exit
 * @param context
 * @param position
 */
async function monitorPosition(context: RuntimeContext, position: Position) {
  // A. Update historical pnl of the position

  // B. Exit
  if (context.state.config.runtime.autoExitEnabled) {
    await exit(context, position);
  }

  // C. Averaging
  const accountConfig = context.helper.getAccountConfig(position.account);
  if (accountConfig.enableWatchLogic) {
    await averaging(context, position);
  }

  // D. Decide goes to speedup stage or back to standard stage vice versa
}

async function averaging(context: RuntimeContext, position: Position) {
  // A. the we decide the default averaging signal
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  // B. Call the onStrategy for the final confirmation approved to averaging
  // context.adapter.onStrategy
  // C. then the actual averaging
  // context.adapter.onAction
}

async function exit(context: RuntimeContext, position: Position) {
  // A. the we decide the default exit signal
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  // B. Call the onStrategy for the final confirmation approved to exit
  // context.adapter.onStrategy
  // C. then the actual exit
  // context.adapter.onAction
}

const position = {
  monitor: monitorPosition,
} as const;

export default position;
