import type { VolatilityPoint } from "@/lib/system/types";
import { runtimeEntrySequences } from "@/lib/system/trading";
import { filterDashboardEntrySignalResponse } from "@/pages/api/market/volatility";
import { describe, expect, it } from "vitest";

function point(id: string, t: number): VolatilityPoint {
  return {
    id,
    l: "B",
    lvl: -3,
    pct: -3,
    p: 1,
    t,
    vb: 1,
    vq: 1,
  } as VolatilityPoint;
}

describe("dashboard volatility response", () => {
  it("returns only the selected range plus each symbol's latest point", () => {
    const response = runtimeEntrySequences.range.crop({
      startTimeMs: 200,
      endTimeMs: 300,
      volatilityMap: {
        SUI: [point("old", 100), point("visible", 250), point("latest", 500)],
      },
    });

    expect(response.SUI.map((item) => item.id)).toEqual(["visible"]);
  });

  it("returns only entry signal markers in the selected range", () => {
    const response = filterDashboardEntrySignalResponse({
      startTimeMs: 200,
      endTimeMs: 300,
      entrySignals: [
        point("old", 100),
        point("visible", 250),
        point("future", 500),
      ],
    });

    expect(response.map((item) => item.id)).toEqual(["visible"]);
  });
});
