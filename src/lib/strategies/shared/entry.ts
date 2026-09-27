import entryAction from "@/lib/system/trading/entry-action";
import tradingEntry from "@/lib/system/trading/entry";
import type {
  RuntimeContext,
  RuntimeEntryCandidate,
  RuntimeEntryDecision,
  RuntimePairEntryDecision,
} from "@/lib/precision/types";

import pairDiagnostics from "./diagnostics";
import pair from "./pair";
import type { EntryLegs, PairLegMeta } from "./pair";

/**
 * Builds one leg decision from a produced entry signal: the role maps the
 * signal direction (MAIN trades it, COUNTER trades opposite), the pair meta
 * rides `decision.strategy` onto `position.strategy.logic` at commit, and
 * the role-scoped vPoint marker records which role consumed the point.
 */
function buildLeg(
  signal: RuntimeEntryDecision,
  role: "MAIN" | "COUNTER",
  pairId: string,
  entryLegs: EntryLegs,
): RuntimeEntryDecision {
  const meta: PairLegMeta = { entryLegs, pairId, role };
  return {
    ...signal,
    direction: pair.direction(signal.direction, role),
    strategy: meta,
    vPointUsage: [pair.roleMarker(signal.accountSlug, role)],
  };
}

/**
 * BOTH:WORKER_PAIR_FUNDING — a pair must fund both legs or neither. Plans
 * each leg against the same spendable snapshot and requires the summed
 * margin + fee + reserve to fit; a leg blocked by drift or its own funding
 * checks vetoes the whole pair before any fill is attempted.
 */
function fundable(
  context: RuntimeContext,
  legs: RuntimeEntryDecision[],
): boolean {
  const plans = legs.flatMap((leg) => {
    const plan = entryAction.plan(context, leg);
    return plan ? [plan] : [];
  });
  if (plans.length !== legs.length) return false;
  const required = plans.reduce(
    (sum, plan) =>
      sum +
      plan.fundingPlan.estimatedMarginUsdt +
      plan.fundingPlan.estimatedFeeUsdt +
      plan.fundingPlan.reserveBudgetUsdt,
    0,
  );
  return required <= plans[0].fundingPlan.spendableUsdt;
}

/**
 * Resolves the account's leg selection for a pair strategy — defaults to
 * `BOTH` per the implementation contract.
 */
function entryLegsOf(context: RuntimeContext, accountSlug: string): EntryLegs {
  return context.helper.getAccount(accountSlug).trading.entryLegs ?? "BOTH";
}

/**
 * Fresh-pair producer shared by pair strategies: runs the default v20
 * signal scan over a pair-collapsed position view (one pair = one worker
 * for `maxOpenPositions`), then reshapes each signal by the account's
 * `entryLegs` — an atomic `pairEntry` for `BOTH`, or a single role leg for
 * `MAIN`/`COUNTER`. Under `openDirection: "ONE_WAY"` the default signals
 * pass through unchanged.
 */
async function findPairs(
  context: RuntimeContext,
): Promise<RuntimeEntryCandidate[]> {
  const openDirection =
    context.state.config.management.openDirection ?? "ONE_WAY";

  const collapsed = pairDiagnostics.view(context);
  const signals = await tradingEntry.findDecisions(collapsed);
  if (openDirection !== "BOTH") return signals;

  const candidates: RuntimeEntryCandidate[] = [];
  for (const signal of signals) {
    const entryLegs = entryLegsOf(context, signal.accountSlug);
    const pairId = pair.buildId(
      signal.accountSlug,
      signal.symbol,
      signal.entrySignal.id,
    );

    if (entryLegs !== "BOTH") {
      candidates.push(buildLeg(signal, entryLegs, pairId, entryLegs));
      continue;
    }

    const legs = [
      buildLeg(signal, "MAIN", pairId, entryLegs),
      buildLeg(signal, "COUNTER", pairId, entryLegs),
    ];
    if (!fundable(context, legs)) continue;

    candidates.push({
      type: "pairEntry",
      accountSlug: signal.accountSlug,
      legs,
      message: signal.message,
      strategy: { entryLegs, pairId },
      symbol: signal.symbol,
    } satisfies RuntimePairEntryDecision);
  }

  return candidates;
}

const pairEntry = {
  buildLeg,
  findPairs,
  fundable,
} as const;

export default pairEntry;
