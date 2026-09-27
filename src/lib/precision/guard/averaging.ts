import type {
  RuntimeAveragingDecision,
  RuntimeContext,
} from "../types";

/**
 * Averaging-family policy, evaluated after the common checks in
 * `guard/index.ts` (account exists, runner toggle, black-swan flag).
 * Averaging currently has no extra family-level rules — the seam exists so
 * per-family policy has a single home identical across environments.
 */
function allows(
  _decision: RuntimeAveragingDecision,
  _context: RuntimeContext,
): boolean {
  return true;
}

const averaging = { allows } as const;

export default averaging;
