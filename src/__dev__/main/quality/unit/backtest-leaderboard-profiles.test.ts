import os from "os";
import path from "path";
import fs from "fs-extra";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type {
    BacktestLeaderboardEntry,
    BacktestLeaderboardMetrics,
} from "@/lib/dev/backtestPrecision/leaderboards";
import backtestLeaderboards from "@/lib/dev/backtestPrecision/leaderboards";
import {
    readLeaf,
    scoreEntries,
} from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import backtestMcp from "@/lib/dev/backtestPrecision/mcp";
import runtimeMcpTools from "@/lib/system/mcp/tools";
import type { RuntimeMcpAuthenticatedToken } from "@/lib/system/mcp/types";
import type {
    RuntimeMcpPermission,
    RuntimeMcpTokenRecord,
} from "@/lib/system/runtime/types";

const TEST_DIR = path.join(
    os.tmpdir(),
    `leaderboard-profiles-test-${process.pid}`,
);
process.env.BACKTEST_LEADERBOARDS_DIR = TEST_DIR;

function authWith(
    permissions: RuntimeMcpPermission[],
): RuntimeMcpAuthenticatedToken {
    const token: RuntimeMcpTokenRecord = {
        createdAt: 1,
        enabled: true,
        id: "tok",
        name: "test",
        permissions,
        tokenHash: "hash",
        tokenSecretEncrypted: "enc",
    };
    return { permissions: new Set(permissions), token };
}

function metrics(overrides: Partial<BacktestLeaderboardMetrics>): BacktestLeaderboardMetrics {
    return {
        avgMonthlyProfitPct: 0,
        balanceTradesScore: 1,
        bearMarketProofRatio: 100,
        capitalEfficiency: { hrScore: 1, score: 1, trScore: 0 },
        emptyBalance: { avg: 0, max: 0, min: 0 },
        gainPct: 0,
        maxFloatingDrawdown: { avg: 0, max: 0, min: 0 },
        maxFloatingDrawdownUsdt: { avg: 0, max: 0, min: 0 },
        maxPortfolioDrawdown: { avg: 0, max: 0, min: 0 },
        monthlyGain: { avg: 0, max: 0, min: 0 },
        positionsClosed: 0,
        sharpeRatio: 0,
        winRate: 0,
        ...overrides,
    };
}

function entry(
    id: string,
    leaderboard: BacktestLeaderboardMetrics,
    backtestConfig: unknown = { range: "1month" },
): BacktestLeaderboardEntry {
    return { backtestConfig, id, leaderboard, t: 1 };
}

describe("leaderboard profiles store", () => {
    afterEach(async () => {
        await fs.remove(TEST_DIR);
    });
    afterAll(async () => {
        await fs.remove(TEST_DIR);
    });

    it("seeds the Daily Income profile on first list", async () => {
        const profiles = await backtestLeaderboards.profiles.list();
        const daily = profiles.find((p) => p.name === "Daily Income");
        expect(daily).toBeTruthy();
        expect(daily?.weights["leaderboard.sharpeRatio"]).toBeGreaterThan(0);
        expect(daily?.weights["leaderboard.tradesPerDay"]).toBeGreaterThan(0);
        expect(daily?.weights["leaderboard.winRate"]).toBeGreaterThan(0);
        expect(
            await fs.pathExists(path.join(TEST_DIR, "profiles.json")),
        ).toBe(true);
    });

    it("upserts by name case-insensitively and validates metric ids", async () => {
        const bad = await backtestLeaderboards.profiles.save({
            name: "bogus",
            weights: { "leaderboard.notAMetric": 1 },
        });
        expect(bad.error).toContain("Unknown metric leaf");

        const saved = await backtestLeaderboards.profiles.save({
            name: "My Mix",
            weights: { "leaderboard.gainPct": 0.6, minEquity: 0.4 },
        });
        expect(saved.profile?.name).toBe("My Mix");

        const renamed = await backtestLeaderboards.profiles.save({
            name: "my mix",
            weights: { "leaderboard.winRate": 1 },
        });
        const names = (await backtestLeaderboards.profiles.list()).map(
            (p) => p.name,
        );
        expect(renamed.profile?.weights["leaderboard.winRate"]).toBe(1);
        expect(names.filter((n) => n.toLowerCase() === "my mix")).toHaveLength(1);

        expect(await backtestLeaderboards.profiles.remove("MY MIX")).toBe(true);
        expect(await backtestLeaderboards.profiles.remove("MY MIX")).toBe(false);
    });
});

describe("leaderboard leaf reads", () => {
    it("prefers the stored tradesPerDay and falls back to range days minus warm-up", () => {
        const stored = entry("a", metrics({ positionsClosed: 10, tradesPerDay: 0.7 }));
        expect(readLeaf(stored, "leaderboard.tradesPerDay")).toBe(0.7);

        // Legacy entry: 90 closed trades over a 180-day "6month" run minus
        // the ~60-day vPoint warm-up → 90 / 120 = 0.75/day.
        const legacy = entry(
            "b",
            metrics({ positionsClosed: 90 }),
            { range: "6month" },
        );
        expect(readLeaf(legacy, "leaderboard.tradesPerDay")).toBeCloseTo(0.75, 3);

        // Custom ranges resolve from explicit start/end times: 90 range days
        // minus the warm-up → 30 trading days → 5 / 30.
        const custom = entry(
            "c",
            metrics({ positionsClosed: 5 }),
            { endTime: 91 * 86400000, range: "custom", startTime: 86400000 },
        );
        expect(readLeaf(custom, "leaderboard.tradesPerDay")).toBeCloseTo(
            5 / 30,
            3,
        );
    });
});

describe("leaderboard scoring", () => {
    const entries = [
        entry("low", metrics({ gainPct: 0, positionsClosed: 5 }), {
            range: "1month",
            settings: {
                accounts: [
                    { enabled: true, sandbox: { initialBalanceUSDT: 900 } },
                ],
            },
        }),
        entry("mid", metrics({ gainPct: 50, positionsClosed: 5 }), {
            range: "1month",
            settings: {
                accounts: [
                    { enabled: true, sandbox: { initialBalanceUSDT: 500 } },
                ],
            },
        }),
        entry("high", metrics({ gainPct: 100, positionsClosed: 5 }), {
            range: "1month",
            settings: {
                accounts: [
                    { enabled: true, sandbox: { initialBalanceUSDT: 100 } },
                ],
            },
        }),
    ];

    it("min-max normalizes a metric across entries", () => {
        const scores = scoreEntries(entries, { "leaderboard.gainPct": 1 });
        expect(scores.get("low")?.score).toBe(0);
        expect(scores.get("mid")?.score).toBe(50);
        expect(scores.get("high")?.score).toBe(100);
    });

    it("flips lower-is-better metrics so the cheapest entry wins", () => {
        const scores = scoreEntries(entries, { minEquity: 1 });
        expect(scores.get("high")?.score).toBe(100);
        expect(scores.get("low")?.score).toBe(0);
    });

    it("negative weights penalize a metric — best entry approaches 0", () => {
        const scores = scoreEntries(entries, { "leaderboard.gainPct": -1 });
        // Pure-penalty profile: scores live on -100..0; least-bad entry wins.
        expect(scores.get("low")?.score).toBe(0);
        expect(scores.get("high")?.score).toBe(-100);
    });

    it("treats flat or missing metrics as neutral 0.5", () => {
        const scores = scoreEntries(entries, {
            "leaderboard.positionsClosed": 1,
            "leaderboard.gainPct": 1,
        });
        // positionsClosed is flat → everyone gets 0.5 there; gainPct spreads.
        // low: (0.5 + 0)/2 → 25, high: (0.5 + 1)/2 → 75
        expect(scores.get("low")?.score).toBe(25);
        expect(scores.get("high")?.score).toBe(75);
        expect(scores.get("high")?.parts["leaderboard.gainPct"]).toBe(1);
    });
});

describe("leaderboard profiles over MCP", () => {
    afterEach(async () => {
        runtimeMcpTools.resetHandlers();
        await fs.remove(TEST_DIR);
    });
    afterAll(async () => {
        await fs.remove(TEST_DIR);
    });

    it("lists, upserts, scores, and deletes profiles through tools", async () => {
        backtestMcp.register();

        const listResult = (await runtimeMcpTools.call({
            arguments: {},
            auth: authWith(["backtest.read"]),
            devToolsEnabled: true,
            name: "backtest_profile_list",
        })) as {
            profiles: { name: string; weights: Record<string, number> }[];
            scoring: string;
        };
        expect(listResult.scoring).toContain("min-max");
        expect(listResult.profiles.map((p) => p.name)).toContain("Daily Income");

        const upsertResult = (await runtimeMcpTools.call({
            arguments: {
                name: "Safe Compounder",
                weights: {
                    "leaderboard.gainPct": 0.5,
                    "leaderboard.maxPortfolioDrawdown.max": 0.3,
                    minEquity: 0.2,
                },
            },
            auth: authWith(["backtest.leaderboard.write"]),
            devToolsEnabled: true,
            name: "backtest_profile_upsert",
        })) as { profile?: { name: string } };
        expect(upsertResult.profile?.name).toBe("Safe Compounder");

        await backtestLeaderboards.store.save({
            backtestConfig: { range: "1month", settings: { marker: 1 } },
            leaderboard: metrics({ gainPct: 100, positionsClosed: 10 }),
        });
        await backtestLeaderboards.store.save({
            backtestConfig: { range: "1month", settings: { marker: 2 } },
            label: "flat",
            leaderboard: metrics({ gainPct: 10, positionsClosed: 10 }),
        });

        const boardResult = (await runtimeMcpTools.call({
            arguments: { profile: "Safe Compounder" },
            auth: authWith(["backtest.read"]),
            devToolsEnabled: true,
            name: "backtest_leaderboard_list",
        })) as {
            entries: { label?: string; score: number }[];
            profile: { name: string };
        };
        expect(boardResult.profile.name).toBe("Safe Compounder");
        expect(boardResult.entries[0].score).toBeGreaterThan(
            boardResult.entries[1].score,
        );

        const unknown = (await runtimeMcpTools.call({
            arguments: { profile: "nope" },
            auth: authWith(["backtest.read"]),
            devToolsEnabled: true,
            name: "backtest_leaderboard_list",
        })) as { available: string[]; error: string };
        expect(unknown.error).toContain("nope");
        expect(unknown.available).toContain("Daily Income");

        const deleteResult = await runtimeMcpTools.call({
            arguments: { name: "Safe Compounder" },
            auth: authWith(["backtest.leaderboard.write"]),
            devToolsEnabled: true,
            name: "backtest_profile_delete",
        });
        expect(deleteResult).toEqual({ ok: true });
    });
});
