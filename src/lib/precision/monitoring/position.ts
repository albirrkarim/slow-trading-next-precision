import { type Position } from "@/lib/trading/models";
import type { RuntimeContext } from "../types";

/**
 * Doing the averaging and exit
 * @param context
 * @param position
 */
async function monitorPosition(context: RuntimeContext, position: Position) {
  // A. Update historical pnl of the position

  // B. Averaging
  const accountConfig = context.helper.getAccountConfig(position.account);
  if (accountConfig.enableWatchLogic) {
    await averaging(context, position);
  }

  // C. Exit
  if (context.state.config.runtime.autoExitEnabled) {
    await exit(context, position);
  }

  // D. Decide goes to speedup stage or back to standard stage vice versa
}

async function averaging(context: RuntimeContext, position: Position) {
  // trying to do averaging
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

async function exit(context: RuntimeContext, position: Position) {
  // trying to do exit from the open position
  // using the config and the exit rules/ conditions we decide the exit.
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

const position = {
  monitor: monitorPosition,
} as const;

export default position;
