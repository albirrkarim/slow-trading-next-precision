import type { RuntimeAccountConfig } from "@/lib/system/runtime";
import blackSwan from "@/lib/system/trading/black-swan";
import type { RuntimeContext, RuntimeDecision } from "../types";
import averaging from "./averaging";
import entry from "./entry";

/**
 * Shared checks every decision passes before family policy, returning the
 * resolved account — or `null` on veto: account exists in the runtime
 * config, non-manual decisions need the runner toggle, exits need
 * autoExitEnabled (or a forced control flag), and black-swan protection
 * blocks entries and averaging including forced ones. Exposed so a
 * strategy-provided `guard.allows` recomposes shared behavior instead of
 * reimplementing it.
 */
function common(
  decision: RuntimeDecision,
  context: RuntimeContext,
): RuntimeAccountConfig | null {
  const state = context.state;
  const account = state.config.accounts.find(
    (item) => item.slug === decision.accountSlug,
  );
  if (!account) return null;

  const manual =
    decision.type === "entry" || decision.type === "pairEntry"
      ? Boolean(decision.manual)
      : decision.type === "exit"
        ? Boolean(decision.position.control?.forceExit)
        : false;

  if (!manual && !state.config.runtime.runnerEnabled) return null;

  if (decision.type === "exit") {
    return manual || state.config.runtime.autoExitEnabled ? account : null;
  }

  // Black Swan protection blocks entries and averaging — including forced
  // ones — while the flag is set on the runtime state.
  const blackSwanProtective = state.blackSwanStatus
    ? blackSwan.state.isProtective(state.blackSwanStatus)
    : state.blackSwanProtective;
  if (blackSwanProtective) return null;

  return account;
}

/**
 * Shared action approval gate between a produced candidate and
 * `adapter.onAction` — identical policy for backtest, sandbox, and live. It
 * reads only the runtime state, so each environment feeds its inputs through
 * `state` (daily-PnL accumulator, black-swan flag, entry cutoff) instead of
 * re-implementing the checks. Environment-specific live-IO rechecks attach
 * as `adapter.onActionEnvGuard` after this gate.
 */
function allows(decision: RuntimeDecision, context: RuntimeContext): boolean {
  const account = common(decision, context);
  if (!account) return false;
  if (decision.type === "exit") return true;

  return decision.type === "averaging"
    ? averaging.allows(decision, context)
    : entry.allows(decision, context, account);
}

const guard = {
  allows,
  common,
  entry,
  averaging,
  dailyPnl: entry.dailyPnl,
} as const;

export default guard;
