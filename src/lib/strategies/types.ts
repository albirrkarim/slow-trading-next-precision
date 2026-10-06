/**
 * Strategy plug-in contract for the multi-strategy runtime.
 *
 * Each module under `src/lib/strategies/<slug>` default-exports an object
 * implementing `StrategyAPI`. The environment adapter (production factory,
 * backtest harness) resolves `management.strategy` through
 * `strategies.resolve` to the matching module — the
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
 *   2. Eligibility + approval   — `(strategy.guard ?? guard).allows` gates
 *      every candidate: shared checks (`guard.common`), per-attempt
 *      capacity, and family policy (`guard.entry`, `guard.averaging`). A
 *      strategy replaces the gate wholesale and reuses those pieces
 *      inside its own `lib/strategies/<slug>/guard` — dropping shared
 *      checks by not delegating drops real protections (runner toggle,
 *      black-swan, daily-PnL stop).
 *   3. Environment approval      — the adapter's optional
 *      `onActionEnvGuard` extension gates every candidate regardless of
 *      producer or guard. To constrain a family it does not override, a
 *      strategy wraps `defaultDecision.<family>.find` and filters the
 *      result — a separate veto member adds nothing.
 *   4. `onAction`/`onPairAction`  — environment execution (sandbox fill or
 *      live order) plus notifications; `pairEntry` decisions route to the
 *      adapter's atomic pair hook. Not strategy-overridable.
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
  RuntimeDecision,
  RuntimeEntryCandidate,
  RuntimeEntryDecision,
  RuntimeExitDecision,
} from "@/lib/precision/types";

/**
 * Strategy modules live at `src/lib/strategies/<slug>` and are selected by
 * `management.strategy`. Absent config means the built-in default pipeline —
 * "default" is not itself a strategy module.
 */
export type StrategySlug =
  | "both"
  | "streak"
  | "streak_with_feature_gate"
  | "default_with_features_gate"
  | "custom_gpt6_astra_bounded_cover_v1";

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
 * This is the capability the guard veto alone cannot
 * provide: `both` needs to emit a MAIN + COUNTER leg pair from one
 * signal, `streak` needs to emit re-entries at its anchor vPoint —
 * both are new candidates the default pipeline will never produce.
 */
export interface StrategyDecisionProducers {
  /**
   * Produces the entry candidates for one capture-entry pass. A pair
   * strategy emits `RuntimePairEntryDecision`s alongside (or instead of)
   * single entries; the engine dispatches each to `adapter.onPairAction`
   * or `adapter.onAction` by `decision.type`.
   */
  entry?: {
    find(context: RuntimeContext): Promise<RuntimeEntryCandidate[]>;
    /**
     * Reshapes one operator-forced single entry into this strategy's
     * candidate form (e.g. an atomic MAIN + COUNTER pair). Returns a
     * skip-reason string when the strategy cannot take it. Omitted → the
     * manual decision runs as-is.
     */
    shape?(
      context: RuntimeContext,
      decision: RuntimeEntryDecision,
    ): RuntimeEntryCandidate | string;
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
 * Strategy-provided approval gate — replaces `guard.allows` wholesale at
 * every monitoring checkpoint (the same `strategy.guard ?? guard` swap as
 * `decisions`). A strategy composes the shared pieces from
 * `@/lib/precision/guard` inside its own gate instead of reimplementing
 * them:
 *
 * ```ts
 * // lib/strategies/both/guard.ts — pair-aware capacity, shared policy
 * const account = guard.common(decision, context); // shared checks first
 * if (!account) return false;
 * if (decision.type === "entry" || decision.type === "pairEntry") {
 *   return (
 *     pairCapacity(decision, context, account) &&
 *     guard.entry.policy(decision, context)
 *   );
 * }
 * return decision.type === "exit" || guard.averaging.allows(decision, context);
 * ```
 */
export interface StrategyGuard {
  /** Approves or vetoes one produced candidate — runs per attempt inside
   * the sequential execution loop, after each prior fill mutates state. */
  allows(decision: RuntimeDecision, context: RuntimeContext): boolean;
}

/**
 * The port every strategy module exposes.
 *
 * Every member is optional except `name`: a strategy plugs in only the
 * pieces it needs; everything else keeps default behavior.
 *
 * Deliberately absent: a strategy-side veto member (producers express
 * suppression by not emitting or by filtering a wrapped
 * `defaultDecision`), `onAction`
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
   * Optional capability flags consumed by shared code that only sees the
   * resolved module (not the config): `pairReentry` marks a pair strategy
   * that keeps pending empty-role re-entries — the entry diagnostics then
   * explain its shared gates the same way `streak` does.
   */
  traits?: {
    pairReentry?: boolean;
  };

  /**
   * Candidate producers replacing `defaultDecision` per family. This is
   * where a `both` strategy emits paired legs and `streak` emits
   * re-entries.
   *
   * Pair/leg metadata (`pairId`, `role`, `entryLegs`) rides on the
   * free-form `decision.strategy` slot: the engine carries it
   * uninterpreted and copies it onto `position.strategy.logic` at commit,
   * so each leg keeps its identity for the whole persisted lifecycle.
   */
  decisions?: StrategyDecisionProducers;

  /**
   * Approval gate replacing the shared `guard.allows` — e.g. `both`
   * overrides entry capacity so MAIN + COUNTER legs on one symbol both
   * pass and `maxOpenPositions` counts pairs, while delegating
   * `guard.common` and `guard.entry.policy` for everything else.
   */
  guard?: StrategyGuard;

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

  /** Optional dashboard explanation hooks — read-only; must never mutate state. */
  diagnostics?: {
    /**
     * Context the default entry diagnostics evaluate; pair strategies
     * collapse legs so a pair counts as one worker.
     */
    view?(context: RuntimeContext): RuntimeContext;
    /**
     * Strategy-specific explanation for one account/symbol, or undefined
     * to fall back to the default explanation. `decision` is the default
     * signal for that account/symbol when the (view) scan produced one.
     */
    explain?(params: {
      context: RuntimeContext;
      accountSlug: string;
      symbol: string;
      decision?: RuntimeEntryDecision;
    }):
      | { code: string; reason: string; status: "blocked" | "ready" }
      | undefined;
  };
}
