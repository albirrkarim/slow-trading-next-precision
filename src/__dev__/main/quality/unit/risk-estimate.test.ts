import { describe, expect, it } from "vitest";

import type { ConfigDraft } from "@/components/settings/settings-types";
import { TradingMode } from "@/lib/exchange/types";
import {
    runtimeDefaults,
    type RuntimeAccountConfig,
    type RuntimeAccountTradingConfig,
} from "@/lib/system/runtime";

import backtestRisk from "@/components/dev/backtest-precision/risk-estimate";

const baseTrading: RuntimeAccountTradingConfig = {
    ...runtimeDefaults.trading.create(),
    exactLeverage: 5,
    maxEntryMargin: 30,
    stopLossPercent: 20,
    stopLossUSDT: 50,
    watchMaxNextAveragingLevels: 3,
    watchReserveLevels: 2,
    watchReservePctAlloc: 2,
};

function makeAccount(
    slug: string,
    overrides: {
        enabled?: boolean;
        initialBalanceUSDT?: number;
        trading?: Partial<RuntimeAccountTradingConfig>;
    } = {},
): RuntimeAccountConfig {
    return {
        createdAt: 0,
        credentials: { apiKey: "", apiSecret: "" },
        description: "",
        enabled: overrides.enabled ?? true,
        name: slug,
        sandbox: { initialBalanceUSDT: overrides.initialBalanceUSDT ?? 1000 },
        slug,
        trading: { ...baseTrading, ...overrides.trading },
        type: "binance",
        updatedAt: 0,
    };
}

function makeSettings(accounts: RuntimeAccountConfig[]): ConfigDraft {
    return {
        accounts,
        management: {
            ...runtimeDefaults.management.create(),
            tradingMode: TradingMode.FUTURES,
        },
        runtime: {
            ...runtimeDefaults.runtime.create(),
            mcp: { tokens: [] },
        },
    };
}

describe("backtestRisk.estimate", () => {
    it("estimates the first-stop loss range from the configured account settings", () => {
        const estimate = backtestRisk.estimate(makeSettings([makeAccount("main")]));

        expect(estimate.accounts).toHaveLength(1);
        const account = estimate.accounts[0];
        expect(account.accountSlug).toBe("main");
        expect(account.entryMarginUsdt).toBe(30);
        expect(account.leverage).toBe(5);
        expect(account.entryLevelMin).toBe(2);
        expect(account.averagingMultiplier).toBe(2);
        expect(account.averagingStages).toBeGreaterThanOrEqual(1);
        // Stage 0 notional 30x5=150 → hard 20% stop ($30) beats the $50 net cap;
        // deeper stages' larger notional makes the $50 net stop earliest.
        expect(account.lossMinUsdt).toBe(30);
        expect(account.lossMaxUsdt).toBe(50);
        expect(estimate.lossMinUsdt).toBe(30);
        expect(estimate.lossMaxUsdt).toBe(50);
    });

    it("reports a single entry-only stage when watch logic is off", () => {
        const estimate = backtestRisk.estimate(
            makeSettings([
                makeAccount("solo", {
                    trading: { enableWatchLogic: false },
                }),
            ]),
        );
        const account = estimate.accounts[0];
        expect(account.averagingStages).toBe(0);
        expect(account.lossMinUsdt).toBe(30);
        expect(account.lossMaxUsdt).toBe(30);
    });

    it("skips disabled and zero-balance accounts", () => {
        const estimate = backtestRisk.estimate(
            makeSettings([
                makeAccount("disabled", { enabled: false }),
                makeAccount("empty", { initialBalanceUSDT: 0 }),
            ]),
        );
        expect(estimate.accounts).toHaveLength(0);
        expect(estimate.lossMinUsdt).toBeNull();
        expect(estimate.lossMaxUsdt).toBeNull();
    });

    it("aggregates the portfolio range across accounts", () => {
        const estimate = backtestRisk.estimate(
            makeSettings([
                makeAccount("wide"),
                makeAccount("tight", { trading: { stopLossUSDT: 10 } }),
            ]),
        );
        expect(estimate.accounts).toHaveLength(2);
        const tight = estimate.accounts.find(
            (account) => account.accountSlug === "tight",
        );
        // $10 net stop is always the earliest boundary → flat $10 range.
        expect(tight?.lossMinUsdt).toBe(10);
        expect(tight?.lossMaxUsdt).toBe(10);
        expect(estimate.lossMinUsdt).toBe(10);
        expect(estimate.lossMaxUsdt).toBe(50);
    });

    it("uses spot leverage 1 for spot management configs", () => {
        const estimate = backtestRisk.estimate({
            ...makeSettings([makeAccount("spot")]),
            management: runtimeDefaults.management.create(),
        });
        expect(estimate.accounts[0].leverage).toBe(1);
    });
});
