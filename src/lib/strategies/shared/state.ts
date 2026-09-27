import type { RuntimeContext } from "@/lib/precision/types";

/**
 * Reads the strategy-owned `state.strategy` slot under a version envelope:
 * `context.state.strategy` is `{v: <slug>, ...shape}`. A slot written by a
 * different strategy — the configured slug switched between restarts —
 * resets to the fresh shape instead of leaking foreign records into the
 * new module's bookkeeping.
 */
function read<T extends { v: string }>(
  context: RuntimeContext,
  version: string,
  empty: () => T,
): T {
  const raw = context.state.strategy;
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { v?: unknown }).v !== version
  ) {
    const fresh = empty();
    context.state.strategy = fresh;
    return fresh;
  }
  return raw as T;
}

/**
 * Read-only variant of `read`: returns the persisted slot when its version
 * matches (a fresh empty shape otherwise) without ever writing
 * `context.state.strategy` — for dashboard/diagnostics paths that must
 * not mutate runtime state.
 */
function peek<T extends { v: string }>(
  context: RuntimeContext,
  version: string,
  empty: () => T,
): T {
  const raw = context.state.strategy;
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { v?: unknown }).v !== version
  ) {
    return empty();
  }
  return raw as T;
}

const strategyState = {
  peek,
  read,
} as const;

export default strategyState;
