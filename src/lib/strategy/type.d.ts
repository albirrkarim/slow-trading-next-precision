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
 *   3. `onStrategy` gate          — environment check AND strategy
 *      `onStrategy` must both approve. Veto only — it can reject a
 *      candidate, never create one (that is what `decisions` is for).
 *   4. `onAction`                 — environment execution (sandbox fill or
 *      live order) plus notifications. Not strategy-overridable.
 *   5. `onExit`                   — environment persistence runs first,
 *      then the strategy's `onExit` observes the closed position.
 *
 * See docs/TODO/multi_strategy.md for the full assessment.
 */

import type { Position } from "@/lib/system/trading";
import type {
  OnExit,
  OnStrategy,
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
 * This is the capability `onStrategy` alone cannot provide: `both` needs
 * to emit a MAIN + COUNTER leg pair from one signal, `streak` needs to
 * emit re-entries at its anchor vPoint — both are new candidates the
 * default pipeline will never produce.
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
 * Strategy-owned persisted state slot.
 *
 * Records a strategy must survive restarts — e.g. streak's pending
 * re-entries (`pairId`, anchor vPoint, direction) — live under a
 * namespaced key such as `state.strategy.<slug>` rather than leaking into
 * engine-owned fields. The engine calls `hydrate` once on boot and
 * `serialize` when persisting state.
 */
export interface StrategyStatePort {
  /** Restores strategy-owned records from their persisted JSON value. */
  hydrate(raw: unknown, context: RuntimeContext): void | Promise<void>;
  /** Serializes strategy-owned records for the next persist cycle. */
  serialize(): unknown;
}

/**
 * The port every strategy module exposes.
 *
 * Every member is optional except `name`: a strategy plugs in only the
 * pieces it needs; everything else keeps default behavior.
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
   * Final approval gate per candidate — composes with the environment's
   * own checks by AND: `isActionAllowed(...) && onStrategy(...)`.
   * Rejects a produced candidate; cannot create one.
   */
  onStrategy?: OnStrategy;

  /**
   * Called with a closed position AFTER the environment's persistence
   * (account state + history append). Observation hook — not the exit
   * decision itself, which belongs to `decisions.exit`.
   */
  onExit?: OnExit;

  /**
   * Optional boot-time validation — e.g. a `both` strategy verifies the
   * account's `futuresPositionMode` is hedge-mode before pair entries.
   * Rejects startup by throwing; the engine surfaces the error.
   */
  preflight?: (context: RuntimeContext) => void | Promise<void>;

  /** Strategy-owned persisted state, if the strategy keeps any. */
  state?: StrategyStatePort;
}
