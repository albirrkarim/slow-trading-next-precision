import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";

/**
 * One dataset candidate row — opened for every detected vPoint (not just
 * level-0 starters), kept pending while the level sequence grows, and closed
 * when an opposite-label point forms on the same symbol. Persisted as one
 * JSON array per symbol under `<run-dir>/dataset/<SYMBOL>.json`.
 */
export interface FeatureGateDatasetRow {
  /**
   * Capture tick (Unix ms, `state.currentTime`) of the first entry-capture
   * pass after the starting point appeared. Undefined until captured —
   * rows that resolve inside a single market pass never see one.
   */
  t?: number;

  /** Base symbol the row's vPoints belong to, e.g. `SUI`. */
  symbol: string;

  /**
   * Feature store pruned to the BTC anchor plus the row's own coin
   * (`features.prune.forPosition`) — the same snapshot a real entry commit
   * would persist. `latestVpoint` reflects the market at capture; the row's
   * own signal is `sequences[0]`, frozen at that same tick.
   * Optional: rows flushed before any capture pass carry none.
   */
  feature?: RuntimeFeatures;

  /**
   * vPoint sequence from the row's own point through any same-label
   * follow-ups to the opposite-label reversal that closed the row —
   * e.g. B₀ → B₋₁ → B₋₂ → T. Each point is frozen (`structuredClone`) at
   * append time, except the starting point frozen at capture, so later
   * `usedBy`/`maxUpPct` mutations never leak into the
   * persisted artifact.
   */
  sequences: VolatilityPoint[];

  /**
   * False while the level sequence is still open. Unresolved rows are
   * dropped at flush — a signal whose reversal never formed is noise, so
   * every persisted row is resolved.
   */
  resolved: boolean;

  /**
   * Same-label points that formed between the row's own point and the
   * reversal — `sequences.length - 2` at close. Lower is better: 0 means an
   * entry on this point caught the level-0 reversal. Omitted on unresolved
   * rows.
   */
  missScore?: number;
}
