import runtimeAccounts from "@/lib/system/runtime/accounts";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
import { describe, expect, it } from "vitest";

describe("account entry-level configuration", () => {
  it("migrates the old minimum without inventing a maximum", () => {
    // BOTH:DECISION_V20_LEVEL_GATE
    const trading = runtimeAccounts.trading.migrate({
      minActionableAbsoluteLevel: 4,
      takeProfitPercent: 5,
    });

    expect(trading.minEntryAbsLevel).toBe(4);
    expect(trading.maxEntryAbsLevel).toBeUndefined();
    expect(trading).not.toHaveProperty("minActionableAbsoluteLevel");
    const backtestTrading = runtimeAccountConfig.trading.fromEffective({
      minActionableAbsoluteLevel: 4,
      takeProfitPercent: 5,
    } as Parameters<typeof runtimeAccountConfig.trading.fromEffective>[0]);
    expect(backtestTrading.minEntryAbsLevel).toBe(4);
  });

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
