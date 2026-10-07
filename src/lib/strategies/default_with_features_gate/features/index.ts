import type { RuntimeContext } from "@/lib/precision/types";
import type { FeatureGateResult, FeatureGateSession } from "@/lib/strategies/feature-gates";
import type { VolatilityPoint } from "@/lib/system/types";

import v3 from "./v3";

interface SessionSlot {
  pending: Promise<FeatureGateSession>;
  ready?: FeatureGateSession;
}

// Helpers are unique per engine, even when one-shot and running engines share state.
const sessions = new WeakMap<RuntimeContext["helper"], SessionSlot>();

/** BOTH:FEATURE_GATE_V3 — loads and warms one isolated model per engine. */
async function warmup(context: RuntimeContext): Promise<void> {
  let slot = sessions.get(context.helper);
  if (!slot) {
    slot = { pending: v3.load() };
    sessions.set(context.helper, slot);
  }
  slot.ready = await slot.pending;
}

/** Rejects entry until this engine's model is ready, then uses frozen v3 inference. */
function gate(context: RuntimeContext, signal: VolatilityPoint): FeatureGateResult {
  const session = sessions.get(context.helper)?.ready;
  if (!session) return { allow: false, message: "v3 NN: model is not warmed up" };
  return session.gate(context.state.currentTime, context.state.features, signal);
}

/** Releases only this engine's session; repeated cleanup and failed loads are harmless. */
async function dispose(context: RuntimeContext): Promise<void> {
  const slot = sessions.get(context.helper);
  if (!slot) return;
  sessions.delete(context.helper);
  // A rejected load allocated no session. Its original error belongs to warmup.
  const session = await slot.pending.catch(() => undefined);
  session?.dispose();
}

const featureGate = { dispose, gate, warmup } as const;
export default featureGate;
