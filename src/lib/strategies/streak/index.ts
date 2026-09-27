import tradingAveraging from "@/lib/system/trading/averaging";
import type { StrategyAPI } from "../types";
import type { OnActionResult } from "@/lib/precision/types";

import pair from "../shared/pair";
import pairDiagnostics from "../shared/diagnostics";
import pairEntry from "../shared/entry";
import sharedPreflight from "../shared/preflight";
import streakEntry from "./entry";
import streakExit from "./exit";
import streakGuard from "./guard";
import streakState from "./state";

/**
 * STREAK:ROLE_REOPEN bookkeeping — when a pair leg closes while its
 * sibling stays open, the empty role is recorded so the entry producer
 * re-opens it (opposite the survivor) at the newest unused vPoint. When a
 * re-entry fills, the role record clears. When the pair dies entirely the
 * record drops — the fresh-pair path re-enters the symbol normally.
 */
const onActionResult: OnActionResult = async (
  result,
  decision,
  position,
  context,
) => {
  if (result === "failed") {
    // A rejected re-entry keeps the role pending; the failure reason is
    // surfaced on the empty-slot card until the next pass retries.
    if (decision.type === "entry") {
      const meta = pair.meta.ofDecision(decision);
      const record = meta?.reopen
        ? streakState.read(context).roles[meta.pairId]
        : undefined;
      if (record) {
        record.reason =
          "Re-entry order failed; retrying on the next pass.";
      }
    }
    return;
  }
  if (!position) return;

  const state = streakState.read(context);
  const positions = Array.isArray(position) ? position : [position];

  if (decision.type === "exit") {
    const meta = pair.meta.ofPosition(positions[0]);
    if (!meta) return;
    const sibling = pair.findSibling(context, meta);
    if (sibling) {
      state.roles[meta.pairId] = {
        accountSlug: positions[0].account,
        pairId: meta.pairId,
        role: meta.role,
        symbol: positions[0].symbol.toUpperCase(),
      };
    } else {
      delete state.roles[meta.pairId];
    }
    return;
  }

  if (decision.type === "entry" || decision.type === "pairEntry") {
    for (const filled of positions) {
      const meta = pair.meta.ofPosition(filled);
      if (
        meta?.reopen &&
        state.roles[meta.pairId]?.role === meta.role
      ) {
        delete state.roles[meta.pairId];
      }
    }
  }
};

const streak: StrategyAPI = {
  name: "streak",
  decisions: {
    entry: { find: streakEntry.find, shape: pairEntry.fromSignal },
    averaging: {
      // STREAK rail averaging — a pair leg consumes any adverse-side
      // vPoint as its next step (level-0 BOTTOMs included for a LONG);
      // the direction-based target owns the favorable exits. Positions
      // without pair meta keep the default |lvl| > 1 gate.
      find: (context, position) =>
        tradingAveraging.findDecision(context, position, {
          levelGate: pair.meta.ofPosition(position)
            ? "adverse"
            : undefined,
        }),
    },
    exit: { find: streakExit.find },
  },
  diagnostics: {
    explain: (params) =>
      pairDiagnostics.explain(params, (ctx, pairId) => {
        const record = streakState.peek(ctx).roles?.[pairId];
        return record
          ? `${record.role} re-entry pending: ${
              record.reason ?? "waiting for the next confirmed unused vPoint"
            }`
          : undefined;
      }),
    view: pairDiagnostics.view,
  },
  guard: { allows: streakGuard.allows },
  onActionResult,
  preflight: sharedPreflight.hedgePositionMode,
};

export default streak;
