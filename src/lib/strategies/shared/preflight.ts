import type { RuntimeContext } from "@/lib/precision/types";

/**
 * PROD:VALIDATE_HEDGE_POSITION_MODE — every enabled account whose
 * `entryLegs` is `BOTH` (the default) participates in pair entries and
 * must declare futures hedge mode; the exchange adapter then verifies
 * the configured mode against the authoritative account mode at order
 * time. Preflight refuses to boot on a missing/mismatched declaration
 * rather than letting a first pair fail mid-entry.
 */
async function hedgePositionMode(context: RuntimeContext): Promise<void> {
  // Backtest simulations have no exchange position mode; sandbox and
  // live accounts keep the check.
  if (context.state.mode === "backtest") return;

  for (const account of context.state.config.accounts) {
    if (!account.enabled) continue;
    if ((account.trading.entryLegs ?? "BOTH") !== "BOTH") continue;
    if (account.futuresPositionMode !== "HEDGE") {
      throw new Error(
        `Pair strategy requires account futuresPositionMode "HEDGE" on ` +
          `account "${account.slug}" while its entryLegs is "BOTH" ` +
          `(configured: ${account.futuresPositionMode ?? "unset"}).`,
      );
    }
  }
}

const preflight = {
  hedgePositionMode,
} as const;

export default preflight;
