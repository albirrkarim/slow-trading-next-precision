import guard from "@/lib/precision/guard";
import type {
  RuntimeAccountConfig,
} from "@/lib/system/runtime";
import type {
  RuntimeContext,
  RuntimeDecision,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";

import pair from "./pair";

/**
 * Pair-aware slot inventory replacing `guard.entry.capacity`:
 *
 * - A `pairEntry` needs an empty symbol slot; the pair itself consumes ONE
 *   worker against `maxOpenPositions` (legs collapse on `pairId`).
 * - A role leg carrying pair meta fills its pair's empty role — no new
 *   worker — or starts a single-leg pair when no pair is open on the
 *   symbol.
 * - A leg without pair meta falls back to the shared capacity check.
 */
function entryCapacity(
  decision: RuntimeEntryCandidate,
  context: RuntimeContext,
  account: RuntimeAccountConfig,
): boolean {
  const open = context.state.openPositions.filter(
    (position) => position.account === decision.accountSlug && !position.closed,
  );
  const symbol = decision.symbol.toUpperCase();
  const workers = new Set(open.map(pair.workerKey));
  const maximum = Math.max(
    0,
    Math.floor(Number(account.trading.maxOpenPositions) || 0),
  );
  const withinMax = () => maximum === 0 || workers.size < maximum;

  if (decision.type === "pairEntry") {
    return !open.some(
      (position) => position.symbol.toUpperCase() === symbol,
    ) && withinMax();
  }

  const meta = pair.meta.ofDecision(decision);
  if (meta) {
    const siblings = open.filter(
      (position) => pair.meta.ofPosition(position)?.pairId === meta.pairId,
    );
    if (siblings.length > 0) {
      // Re-entry fills the pair's empty role — veto only when the role is
      // already filled; the pair's worker slot is already accounted.
      return !siblings.some(
        (position) => pair.meta.ofPosition(position)?.role === meta.role,
      );
    }
    return (
      !open.some(
        (position) => position.symbol.toUpperCase() === symbol,
      ) && withinMax()
    );
  }

  return guard.entry.capacity(decision, context, account);
}

/**
 * The pair-strategy gate — composes the shared pieces so runner toggle,
 * black-swan, daily-PnL stop, catalog, min-price, stale-signal, and
 * entry-cutoff protections stay enforced while the capacity check becomes
 * pair-aware. `exit` always passes common (autoExit/forceExit policy
 * lives there); `averaging` keeps the shared averaging gate.
 */
function allows(decision: RuntimeDecision, context: RuntimeContext): boolean {
  const account = guard.common(decision, context);
  if (!account) return false;

  if (decision.type === "exit") return true;
  if (decision.type === "averaging") {
    return guard.averaging.allows(decision, context);
  }

  if (!account.enabled) return false;
  return (
    entryCapacity(decision, context, account) &&
    guard.entry.policy(decision, context)
  );
}

const pairGuard = {
  allows,
  entryCapacity,
} as const;

export default pairGuard;
