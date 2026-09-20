import type { BacktestPrecisionParams } from "@/lib/dev/backtestPrecision/api/precision-api-types";
import { createInitialBalance } from "@/lib/dev/backtestPrecision/backtest";
import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";
import { describe, expect, it } from "vitest";

function createParams(
  accounts: SlowTradingSettingsConfig["accounts"],
): BacktestPrecisionParams {
  return {
    config: {
      accounts,
      management: {},
      runtime: {},
    } as unknown as SlowTradingSettingsConfig,
    range: "1week",
    upToDateDecisionBacktest: false,
    upToDateKlines: false,
  };
}

describe("precision backtest initial balance", () => {
  it("uses each enabled account sandbox initial balance", () => {
    const params = createParams([
      {
        enabled: true,
        sandbox: { enabled: true, initialBalanceUSDT: 1_250 },
        slug: "primary",
      },
      {
        enabled: false,
        sandbox: { enabled: true, initialBalanceUSDT: 9_999 },
        slug: "disabled",
      },
    ] as SlowTradingSettingsConfig["accounts"]);

    expect(createInitialBalance(params)).toEqual({
      primary: {
        available: 1_250,
        locked: 0,
        reserved: 0,
        safeHaven: 0,
        spendable: 1_250,
        startingBalance: 1_250,
        total: 1_250,
      },
    });
  });

  it("normalizes invalid starting balances to zero", () => {
    const params = createParams([
      {
        enabled: true,
        sandbox: { enabled: true, initialBalanceUSDT: -100 },
        slug: "primary",
      },
    ] as SlowTradingSettingsConfig["accounts"]);

    expect(createInitialBalance(params).primary).toEqual({
      available: 0,
      locked: 0,
      reserved: 0,
      safeHaven: 0,
      spendable: 0,
      startingBalance: 0,
      total: 0,
    });
  });
});
