import tradingAveraging from "@/lib/system/trading/averaging";
import type { StrategyAPI } from "../types";
import type { OnActionResult } from "@/lib/precision/types";

import pair from "../shared/pair";
import pairDiagnostics from "../shared/diagnostics";
import pairEntry from "../shared/entry";
import pairGuard from "../shared/guard";
import sharedPreflight from "../shared/preflight";
import bothExit from "./exit";
import bothState from "./state";

/**
 * Close reasons that cascade to the pair's surviving leg — per
 * BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS the stop-loss family propagates, and
 * BOTH:VOLATILITY_TARGET_EXIT resets both sides at the armed target.
 */
const CASCADE_REASONS = new Set([
  "STOP_LOSS",
  "STOP_LOSS_BY_USDT_LOSS",
  "VOLATILITY_TARGET_EXIT",
]);

/**
 * Records the pair-close bookkeeping after a leg's successful exit: while
 * the sibling survives, the closed leg's slim snapshot lands on
 * `state.closed` (so the UI can keep showing it) and a stop-loss-family
 * or target close additionally marks the sibling `pendingClose` so its
 * next produced exit force-closes with the same reason. Both records
 * clear once no open leg of the pair remains.
 */
const onActionResult: OnActionResult = async (
  result,
  decision,
  position,
  context,
) => {
  if (
    result !== "success" ||
    decision.type !== "exit" ||
    !position ||
    Array.isArray(position)
  ) {
    return;
  }
  const meta = pair.meta.ofPosition(position);
  if (!meta) return;

  const state = bothState.read(context);
  const sibling = pair.findSibling(context, meta);

  if (!sibling) {
    delete state.closed[meta.pairId];
    delete state.pendingClose[meta.pairId];
    return;
  }

  state.closed[meta.pairId] = pair.closedLeg.snapshot(position, meta.role);

  const reason = position.closed?.reason;
  if (reason && CASCADE_REASONS.has(reason)) {
    state.pendingClose[meta.pairId] = {
      message: position.closed?.message ?? reason,
      reason,
    };
  }
};

const both: StrategyAPI = {
  name: "both",
  decisions: {
    entry: { find: pairEntry.findPairs },
    averaging: {
      // BOTH:LOW_LEVEL_NEXT_ADVERSE_AVERAGING — a verified pair leg may
      // consume its exact next adverse watch step at level ±1; positions
      // without pair meta keep the default |lvl| > 1 gate.
      find: (context, position) =>
        tradingAveraging.findDecision(context, position, {
          levelGate: pair.meta.ofPosition(position)
            ? "lowLevel"
            : undefined,
        }),
    },
    exit: { find: bothExit.find },
  },
  diagnostics: {
    explain: (params) => pairDiagnostics.explain(params),
    view: pairDiagnostics.view,
  },
  guard: { allows: pairGuard.allows },
  onActionResult,
  preflight: sharedPreflight.hedgePositionMode,
};

export default both;
