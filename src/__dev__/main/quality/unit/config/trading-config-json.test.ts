import { describe, expect, it } from "vitest";

import tradingConfigJson from "@/components/settings/Trading/trading-config-json";

describe("trading config JSON", () => {
  // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — the optional per-account drift
  // cap override must round-trip through the copy/paste JSON editor.
  it("accepts the late-entry drift cap as a finite number", () => {
    const parsed = tradingConfigJson.parse(
      JSON.stringify({
        lateEntryVPointPriceDriftPct: 0.2,
        notes: "",
        takeProfitPercent: 5,
      }),
    );

    expect(parsed.lateEntryVPointPriceDriftPct).toBe(0.2);
  });

  it("rejects a non-number drift cap and keeps it optional", () => {
    expect(() =>
      tradingConfigJson.parse(
        JSON.stringify({
          lateEntryVPointPriceDriftPct: "0.2",
          notes: "",
          takeProfitPercent: 5,
        }),
      ),
    ).toThrow('"lateEntryVPointPriceDriftPct" must be a finite number.');

    const parsed = tradingConfigJson.parse(
      JSON.stringify({ notes: "", takeProfitPercent: 5 }),
    );
    expect(parsed.lateEntryVPointPriceDriftPct).toBeUndefined();
  });
});
