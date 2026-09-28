import { entry } from "@/lib/system/trading";
import type { EntryRecommendation } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";


const entrySequenceCandidates = {
  threshold: {
    /**
     * Resolves the dashboard threshold with the same rules as the entry gate.
     */
    resolve(value?: number) {
      return entry.threshold.resolve(value);
    },
    resolveMax(value?: number) {
      return entry.threshold.resolveMax(value);
    },
  },

  /**
   * Builds client-side entry candidates from loaded vPoints for dashboard-only
   * metric estimates. This avoids replaying the full decision engine on the API
   * path when the metric panels are collapsed.
   */
  build({
    minEntryAbsLevel,
    maxEntryAbsLevel,
    volatilityMap,
  }: {
    minEntryAbsLevel?: number;
    maxEntryAbsLevel?: number;
    volatilityMap: Record<string, VolatilityPoint[]>;
  }): EntryRecommendation[] {
    const threshold = entrySequenceCandidates.threshold.resolve(
      minEntryAbsLevel,
    );
    const maximum = entrySequenceCandidates.threshold.resolveMax(
      maxEntryAbsLevel,
    );

    return Object.entries(volatilityMap).flatMap(([rawSymbol, points]) => {
      const symbol = rawSymbol.trim().toUpperCase();
      if (symbol === "BTC") return [];

      return points
        .filter((point) => entry.threshold.contains(point.lvl, threshold, maximum))
        .map((point) => ({
          ...point,
          amountProbab: 1,
          maxLeverage: 1,
          message: "client vPoint entry candidate",
          symbol,
        }));
    });
  },
};

export default entrySequenceCandidates;
