import runtimeAccounts from "@/lib/system/runtime/accounts";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
import { runtimeDefaults } from "@/lib/system/runtime";
import { describe, expect, it } from "vitest";

describe("account entry-level configuration", () => {

  it("preserves a disabled minimum and an active zero maximum", () => {
    const trading = runtimeAccounts.trading.migrate({
      maxEntryAbsLevel: 0,
      takeProfitPercent: 5,
    });

    expect(trading.minEntryAbsLevel).toBeUndefined();
    expect(trading.maxEntryAbsLevel).toBe(0);
    expect(runtimeAccountConfig.trading.keys.dynamic).toContain("maxEntryAbsLevel");
  });
});

describe("account late-entry drift cap configuration", () => {
  // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — the optional per-account cap
  // override is a Trading-tab key that must survive the flat effective
  // config split and persisted-record migration.
  it("round-trips the per-account drift cap and keeps unset automatic", () => {
    expect(runtimeAccountConfig.trading.keys.dynamic).toContain(
      "lateEntryVPointPriceDriftPct",
    );

    // Persisted records keep a configured percent; records without the key
    // stay undefined so the volatility-derived cap still applies.
    expect(
      runtimeAccounts.trading.migrate({
        lateEntryVPointPriceDriftPct: 0.2,
        takeProfitPercent: 5,
      }).lateEntryVPointPriceDriftPct,
    ).toBe(0.2);
    expect(
      runtimeAccounts.trading.migrate({ takeProfitPercent: 5 })
        .lateEntryVPointPriceDriftPct,
    ).toBeUndefined();

    const flat = runtimeAccountConfig.trading.toEffective(
      runtimeDefaults.management.create(),
      {
        trading: {
          lateEntryVPointPriceDriftPct: 0.2,
          notes: "",
          takeProfitPercent: 5,
        },
      },
    );
    expect(flat.lateEntryVPointPriceDriftPct).toBe(0.2);
    expect(
      runtimeAccountConfig.trading.fromEffective(flat)
        .lateEntryVPointPriceDriftPct,
    ).toBe(0.2);

    const unsetFlat = runtimeAccountConfig.trading.toEffective(
      runtimeDefaults.management.create(),
      { trading: { notes: "", takeProfitPercent: 5 } },
    );
    expect(unsetFlat.lateEntryVPointPriceDriftPct).toBeUndefined();
    expect(
      runtimeAccountConfig.trading.fromEffective(unsetFlat)
        .lateEntryVPointPriceDriftPct,
    ).toBeUndefined();
  });
});
