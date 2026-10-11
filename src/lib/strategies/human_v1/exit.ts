import type { RuntimeContext, RuntimeExitDecision } from "@/lib/precision/types";
import type { Position } from "@/lib/system/trading";
import tradingExit from "@/lib/system/trading/exit";

import type { HumanV1Logic } from "./entry";
import humanSignal from "./signal";

/** The human_v1 payload of a position it opened, when it did. */
function logicOf(position: Position): HumanV1Logic | undefined {
  const logic = position.strategy.logic as Partial<HumanV1Logic> | undefined;
  return logic?.v === "human_v1" ? (logic as HumanV1Logic) : undefined;
}

/**
 * Cross-back reason when the live mark is back on the wrong side of the
 * position's EMA: a LONG below it, a SHORT above it. Uses the latest mark
 * against the EMA's last closed-candle value.
 */
function crossBackReason(context: RuntimeContext, position: Position): string | undefined {
  const logic = logicOf(position);
  if (!logic) return undefined;
  const symbol = position.symbol.toUpperCase();
  const reading = humanSignal.read(
    context.state.features,
    symbol,
    context.state.markPriceMap[symbol]?.price,
    logic.emaId,
  );
  if (reading.emaValue === undefined || reading.markPrice === undefined) return undefined;
  const side = humanSignal.emaSide(reading.markPrice, reading.emaValue);
  const crossedBack = position.direction === "LONG" ? side === -1 : side === 1;
  return crossedBack
    ? `HUMAN_V1:EMA_CROSS mark ${reading.markPrice} crossed back ` +
        `${position.direction === "LONG" ? "below" : "above"} ${reading.emaId} ${reading.emaValue}`
    : undefined;
}

/**
 * Exit producer: every shared exit rule first (TP, SL, max hold, … — the
 * operator disables unused ones in config), then human_v1's EMA cross-back
 * for positions it opened, sold through the forced-exit path so fees and
 * PnL settle exactly like any other exit.
 */
async function find(context: RuntimeContext, position: Position): Promise<RuntimeExitDecision | null> {
  const shared = await tradingExit.findDecision(context, position);
  if (shared) return shared;

  // BOTH:HUMAN_V1_EMA_EXIT
  const reason = crossBackReason(context, position);
  if (!reason) return null;
  const decision = await tradingExit.findDecision(context, {
    ...position,
    control: {
      ...position.control,
      forceExit: { closeReason: "STRATEGY_EXIT", reason },
    },
  });
  return decision ? { ...decision, position } : null;
}

const humanExit = { crossBackReason, find } as const;

export default humanExit;
