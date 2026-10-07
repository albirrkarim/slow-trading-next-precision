import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types";
import features from "@/lib/features";

import type { FeatureGateDatasetRow } from "./types";

/**
 * Per-run dataset collector behind the backtest adapter hooks. Every
 * detected vPoint opens a candidate row; rows stay pending while same-label
 * points extend their sequence and close on the first opposite-label point,
 * scoring each entry by how many same-label points it missed (B₀→B₋₁→B₋₂→T
 * yields missScores 2, 1, 0). Feature snapshots are taken once per row at
 * the first `onEntryCapture` pass after it opens — the same pruned store a
 * real entry commit would persist.
 */
function create() {
  /** Still-open candidate rows keyed by symbol, oldest first. */
  const pending = new Map<string, FeatureGateDatasetRow[]>();
  /** Closed (and later flushed) rows in close order — creation-sorted. */
  const closed: FeatureGateDatasetRow[] = [];
  // Keep the live starting point until capture so observed excursions match
  // the capture tick. No live reference is persisted.
  const signals = new Map<FeatureGateDatasetRow, VolatilityPoint>();

  return {
    /**
     * Feeds one freshly detected vPoint (adapter `onNewVPoint` order —
     * chronological, before the retention trim): extends every same-label
     * pending row on the symbol, closes every opposite-label pending row
     * with this point as the reversal, then opens the point's own row.
     */
    onVPoint(
      _context: Pick<RuntimeContext, "state">,
      symbol: string,
      point: VolatilityPoint,
    ): void {
      const rows = pending.get(symbol) ?? [];
      const survivors: FeatureGateDatasetRow[] = [];
      for (const row of rows) {
        row.sequences.push(structuredClone(point));
        if (row.sequences[0].l === point.l) {
          survivors.push(row);
          continue;
        }
        row.missScore = row.sequences.length - 2;
        row.resolved = true;
        signals.delete(row);
        closed.push(row);
      }
      const row: FeatureGateDatasetRow = {
        resolved: false,
        sequences: [structuredClone({ ...point, symbol })],
        symbol,
      };
      signals.set(row, point);
      survivors.push(row);
      pending.set(symbol, survivors);
    },

    /**
     * First-capture feature snapshot: every pending row without a capture
     * stamps `t` and the pruned feature store. Later passes skip stamped
     * rows — a `t` already set means the snapshot exists even when the
     * store itself was empty (`feature` stays undefined).
     */
    captureFeatures(context: RuntimeContext): void {
      for (const rows of pending.values()) {
        for (const row of rows) {
          if (row.t !== undefined) continue;
          // BTEST:FEATURE_GATE_DATASET — freeze this row's own signal, even
          // when another same-label point became latest before capture.
          row.sequences[0] = structuredClone({
            ...(signals.get(row) ?? row.sequences[0]),
            symbol: row.symbol,
          });
          signals.delete(row);
          row.t = context.state.currentTime;
          row.feature = features.prune.forPosition(
            context.state.features,
            row.symbol,
          );
        }
      }
    },

    /**
     * Run-end finalize: drops the still-pending rows — a signal whose
     * reversal never formed is noise, so only resolved rows are persisted.
     */
    flush(): FeatureGateDatasetRow[] {
      pending.clear();
      signals.clear();
      return closed;
    },

    /** Every collected row — closed rows then any rows still pending. */
    rows(): FeatureGateDatasetRow[] {
      return [...closed, ...[...pending.values()].flat()];
    },
  };
}

const collector = { create } as const;

export default collector;
