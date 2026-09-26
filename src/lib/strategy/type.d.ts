/**
 * Strategy plug-in contract for the multi-strategy runtime.
 *
 * Each module under `src/lib/strategies/<slug>` default-exports an object
 * implementing `StrategyAPI`. The environment adapter (production factory,
 * backtest harness) resolves `config.strategy` to the matching module — the
 * plug is env-neutral so the same strategy runs identically in backtest,
 * sandbox, and live.
 *
 * Pipeline contract per stage, unchanged by the strategy:
 *
 *   produce candidates → limits/veto gate → execute → bookkeeping
 *
 *   1. `decisions.<family>.find`  — produces candidates (default:
 *      `defaultDecision.<family>`). A strategy replaces a producer only
 *      for the families it declares.
 *   2. Engine eligibility checks  — `canAttemptEntry`, account limits,
 *      environment `isActionAllowed`. Always run; a strategy cannot
 *      disable them.
 *   3. Environment approval      — `adapter.onStrategy` gates every
 *      candidate regardless of producer. To constrain a family it does
 *      not override, a strategy wraps `defaultDecision.<family>.find`
 *      and filters the result — a separate veto member adds nothing.
 *   4. `onAction`                 — environment execution (sandbox fill or
 *      live order) plus notifications. Not strategy-overridable.
 *   5. `onActionResult`           — the strategy observes the outcome:
 *      success carries the produced position (entries, averagings, and
 *      exits alike), failure carries null.
 *
 * See docs/TODO/multi_strategy.md for the full assessment.
 */

import type { Position } from "@/lib/system/trading";
import type {
  OnActionResult,
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimeExitDecision,
} from "@/lib/precision/types";

/**
 * Strategy modules live at `src/lib/strategies/<slug>` and are selected by
 * `config.strategy`. Absent config means the built-in default pipeline —
 * "default" is not itself a strategy module.
 */
export type StrategySlug = "both" | "streak";

/**
 * Candidate producers — one per decision family, mirroring the
 * `defaultDecision` grouped API so the engine swap is a drop-in:
 *
 * ```ts
 * const producer = strategy.decisions?.entry ?? defaultDecision.entry;
 * const decisions = await producer.find(context);
 * ```
 *
 * `entry` produces the whole candidate list for the capture-entry pass;
 * `averaging` and `exit` are evaluated per open position, matching the
 * monitoring loop. Omitting a family keeps the built-in producer for it.
 *
 * This is the capability the `adapter.onStrategy` veto alone cannot
 * provide: `both` needs to emit a MAIN + COUNTER leg pair from one
 * signal, `streak` needs to emit re-entries at its anchor vPoint —
 * both are new candidates the default pipeline will never produce.
 */
export interface StrategyDecisionProducers {
  /** Produces the entry candidates for one capture-entry pass. */
  entry?: {
    find(context: RuntimeContext): Promise<RuntimeEntryDecision[]>;
  };
  /** Evaluates one open position for an averaging candidate. */
  averaging?: {
    find(
      context: RuntimeContext,
      position: Position,
    ): Promise<RuntimeAveragingDecision | null>;
  };
  /** Evaluates one open position for an exit candidate. */
  exit?: {
    find(
      context: RuntimeContext,
      position: Position,
    ): Promise<RuntimeExitDecision | null>;
  };
}

/**
 * The port every strategy module exposes.
 *
 * Every member is optional except `name`: a strategy plugs in only the
 * pieces it needs; everything else keeps default behavior.
 *
 * Deliberately absent: `onStrategy` (producers express suppression by not
 * emitting or by filtering a wrapped `defaultDecision`), `onAction`
 * (execution is environment-owned — sandbox fill vs live order plus
 * atomic pair rollback are adapter concerns, not strategy concerns),
 * `onExit` (a close is just an `onActionResult("success")` whose
 * `decision.type === "exit"`), and a state port (strategy-owned records —
 * e.g. streak pending re-entries — live in the free-form
 * `RuntimeEngineState.strategy` slot that snapshots carry into test cases
 * automatically).
 */
export interface StrategyAPI {
  /** Module slug — must match the `src/lib/strategies/<slug>` folder. */
  name: StrategySlug;

  /**
   * Candidate producers replacing `defaultDecision` per family. This is
   * where a `both` strategy emits paired legs and `streak` emits
   * re-entries.
   *
   * Pair/leg metadata (`pairId`, `role`, `entryLegs`) is strategy-owned
   * data the decision types do not yet carry — it rides on the pending
   * `decision.strategy`/per-decision metadata slot tracked in
   * multi_strategy.md, not on fields invented per strategy.
   */
  decisions?: StrategyDecisionProducers;

  /**
   * Called after `adapter.onAction` ran a decision — `"success"` carries
   * the produced position, `"failed"` carries `null`. This is the
   * strategy's commit point for bookkeeping a producer cannot express:
   * e.g. streak registers a pending re-entry only once the parent entry
   * actually filled, `both` marks a pair leg filled, and a closed
   * position is observed via `decision.type === "exit"` on success.
   * Runs after the engine's own bookkeeping and before the env
   * persistence flush; vetoed candidates never reach `onAction`.
   */
  onActionResult?: OnActionResult;

  /**
   * Optional boot-time validation — e.g. a `both` strategy verifies the
   * account's `futuresPositionMode` is hedge-mode before pair entries.
   * Rejects startup by throwing; the engine surfaces the error.
   */
  preflight?: (context: RuntimeContext) => void | Promise<void>;

}
