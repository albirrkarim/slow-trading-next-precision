import runtimeAccounts from "@/lib/system/runtime/accounts";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
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
