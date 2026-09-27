import type { RuntimeContext } from "@/lib/precision/types";

/**
 * PROD:VALIDATE_HEDGE_POSITION_MODE — while `openDirection` is `BOTH`,
 * every enabled account participates in pair entries and must declare
 * futures hedge mode; the exchange adapter then verifies the configured
 * mode against the authoritative account mode at order time. Preflight
 * refuses to boot on a missing/mismatched declaration rather than letting
 * a first pair fail mid-entry.
 */
async function hedgePositionMode(context: RuntimeContext): Promise<void> {
  const openDirection =
    context.state.config.management.openDirection ?? "ONE_WAY";
  if (openDirection !== "BOTH") return;

  for (const account of context.state.config.accounts) {
    if (!account.enabled) continue;
    if (account.trading.futuresPositionMode !== "HEDGE") {
      throw new Error(
        `Pair strategy requires trading.futuresPositionMode "HEDGE" on ` +
          `account "${account.slug}" while management.openDirection is ` +
          `"BOTH" (configured: ` +
          `${account.trading.futuresPositionMode ?? "unset"}).`,
      );
    }
  }
}

const preflight = {
  hedgePositionMode,
} as const;

export default preflight;
