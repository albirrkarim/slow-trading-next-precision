import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import type { Position } from "@/lib/system/trading";

import pairEntry from "./entry";
import pair from "./pair";
import type { PairLegMeta, PairRole } from "./pair";

/** One strategy explanation row the dashboard renders for a coin. */
export interface PairDiagnosticsResult {
  code: string;
  reason: string;
  status: "blocked" | "ready";
}

interface PairDiagnosticsParams {
  context: RuntimeContext;
  accountSlug: string;
  symbol: string;
  decision?: RuntimeEntryDecision;
}

/**
 * The context view the entry-diagnostics pipeline evaluates for pair
 * strategies: pair legs collapse to one worker so `maxOpenPositions` and
 * the same-symbol block count a pair as a single position.
 */
function view(context: RuntimeContext): RuntimeContext {
  return {
    ...context,
    state: {
      ...context.state,
      openPositions: pair.collapse(context.state.openPositions),
    },
  };
}

/**
 * Explains why a coin carries no fresh pair: an open pair (or leftover
 * leg) blocks a new entry, or the current signal cannot fund both sides.
 * Returns undefined when the default single-entry explanation applies.
 */
function explain(
  params: PairDiagnosticsParams,
  emptyRoleReason?: (
    context: RuntimeContext,
    pairId: string,
  ) => string | undefined,
): PairDiagnosticsResult | undefined {
  const { context, accountSlug, symbol } = params;
  const account = context.state.config.accounts.find(
    (candidate) => candidate.slug === accountSlug,
  );
  const entryLegs = account?.trading.entryLegs ?? "BOTH";
  // A MAIN/COUNTER account is the per-account one-way path — the default
  // single-entry explanation applies.
  if (entryLegs !== "BOTH") return undefined;

  const legs: { meta: PairLegMeta; position: Position }[] = [];
  for (const position of context.state.openPositions) {
    if (
      position.closed ||
      position.account !== accountSlug ||
      position.symbol.toUpperCase() !== symbol
    ) {
      continue;
    }
    const meta = pair.meta.ofPosition(position);
    if (meta) legs.push({ meta, position });
  }

  if (legs.length >= 2) {
    return {
      code: "PAIR_OPEN",
      reason: "MAIN and COUNTER legs are open.",
      status: "blocked",
    };
  }

  if (legs.length === 1) {
    const meta = legs[0].meta;
    if (meta.entryLegs !== "BOTH") {
      return {
        code: "PAIR_OPEN",
        reason: `${meta.role} leg is open (entryLegs ${meta.entryLegs}).`,
        status: "blocked",
      };
    }
    const emptyRole: PairRole = meta.role === "MAIN" ? "COUNTER" : "MAIN";
    return {
      code: "PAIR_ROLE_EMPTY",
      reason:
        emptyRoleReason?.(context, meta.pairId) ??
        `${emptyRole} leg closed; a new pair opens after the ${meta.role} leg closes.`,
      status: "blocked",
    };
  }

  if (params.decision) {
    const pairId = pair.buildId(
      accountSlug,
      symbol,
      params.decision.entrySignal.id,
    );
    const plannedLegs = [
      pairEntry.buildLeg(params.decision, "MAIN", pairId, "BOTH"),
      pairEntry.buildLeg(params.decision, "COUNTER", pairId, "BOTH"),
    ];
    if (!pairEntry.fundable(context, plannedLegs)) {
      return {
        code: "PAIR_FUNDING_INSUFFICIENT",
        reason:
          "Blocked because spendable balance cannot fund both MAIN and " +
          "COUNTER legs, or one leg's entry plan is blocked (funding or " +
          "late-entry drift).",
        status: "blocked",
      };
    }
  }

  return undefined;
}

const pairDiagnostics = {
  explain,
  view,
} as const;

export default pairDiagnostics;
