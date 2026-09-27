import type { RuntimeContext, RuntimeDecision } from "../types";
import averaging from "./averaging";
import entry from "./entry";

/**
 * Shared action approval gate between a produced candidate and
 * `adapter.onAction` — identical policy for backtest, sandbox, and live. It
 * reads only the runtime state, so each environment feeds its inputs through
 * `state` (daily-PnL accumulator, black-swan flag, entry cutoff) instead of
 * re-implementing the checks. Environment-specific live-IO rechecks attach
 * as `adapter.onActionEnvGuard` after this gate.
 */
function allows(decision: RuntimeDecision, context: RuntimeContext): boolean {
  const state = context.state;
  const account = state.config.accounts.find(
    (item) => item.slug === decision.accountSlug,
  );
  if (!account) return false;

  const manual =
    decision.type === "entry"
      ? Boolean(decision.manual)
      : decision.type === "exit"
        ? Boolean(decision.position.control?.forceExit)
        : false;

  if (!manual && !state.config.runtime.runnerEnabled) return false;

  if (decision.type === "exit") {
    return manual || state.config.runtime.autoExitEnabled;
  }

  // Black Swan protection blocks entries and averaging — including forced
  // ones — while the flag is set on the runtime state.
  if (state.blackSwanProtective) return false;

  return decision.type === "averaging"
    ? averaging.allows(decision, context)
    : entry.allows(decision, context, account);
}

const guard = {
  allows,
  dailyPnl: entry.dailyPnl,
} as const;

export default guard;
