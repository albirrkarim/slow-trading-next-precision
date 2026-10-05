import os from "os";
import path from "path";
import fs from "fs-extra";
import { afterAll, describe, expect, it } from "vitest";

import { createTestPosition } from "../fixtures/position";
import { computeLeaderboardMetrics } from "@/lib/dev/backtestPrecision/leaderboards/metrics";
import leaderboardsStore from "@/lib/dev/backtestPrecision/leaderboards/store";
import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { VolatilityPoint } from "@/lib/system/types";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);
const TEST_DIR = path.join(os.tmpdir(), `leaderboards-test-${process.pid}`);
process.env.BACKTEST_LEADERBOARDS_DIR = TEST_DIR;

function snapshot(t: number, total: number, overrides: Partial<BacktestBalanceSnapshot> = {}): BacktestBalanceSnapshot {
    return {
        available: total,
        locked: 0,
        reserved: 0,
        safeHaven: 0,
        spendable: total,
        startingBalance: 1000,
        t,
        total,
        ...overrides,
    };
}

function vPoint(t: number, p: number): VolatilityPoint {
    return { id: `B_${t}`, l: "B", lvl: -2, p, pct: 5, t, vb: 1, vq: 1 };
}

describe("backtest leaderboards metrics", () => {
    it("computes gain, win rate, and closed count across accounts", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [snapshot(T0, 1000), snapshot(T0 + 30 * DAY, 1200)],
                acc2: [
                    snapshot(T0, 500, { startingBalance: 500 }),
                    snapshot(T0 + 30 * DAY, 400, { startingBalance: 500 }),
                ],
            },
            positions: [
                createTestPosition({
                    closed: { feeUsdt: 0, price: 11, reason: "TAKE_PROFIT", t: T0 + 5 * DAY },
                    pnl: { netUsdt: 50 },
                    symbol: "AAA",
                }),
                createTestPosition({
                    closed: { feeUsdt: 0, price: 9, reason: "STOP_LOSS", t: T0 + 6 * DAY },
                    pnl: { netUsdt: -20 },
                    symbol: "BBB",
                }),
            ],
        });

        // (1600 - 1500) / 1500 = 6.67%
        expect(metrics.gainPct).toBeCloseTo(6.67, 1);
        expect(metrics.winRate).toBe(50);
        expect(metrics.positionsClosed).toBe(2);
    });

    it("measures drawdown columns from per-position pnl extrema", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [
                    snapshot(T0, 1000),
                    snapshot(T0 + 10 * DAY, 980),
                    snapshot(T0 + 20 * DAY, 990),
                    snapshot(T0 + 30 * DAY, 990),
                ],
            },
            positions: [
                createTestPosition({
                    closed: { feeUsdt: 0, price: 9, reason: "STOP_LOSS", t: T0 + 25 * DAY },
                    pnl: { maxDownPct: -10, maxDownUsdt: -20, netUsdt: -20 },
                }),
                createTestPosition({
                    closed: { feeUsdt: 0, price: 11, reason: "TAKE_PROFIT", t: T0 + 12 * DAY },
                    pnl: { maxDownPct: -4, maxDownUsdt: -10, netUsdt: 30 },
                }),
                // No extrema recorded — excluded from both drawdown ranges.
                createTestPosition({
                    closed: { feeUsdt: 0, price: 10, reason: "FINAL", t: T0 + 8 * DAY },
                    pnl: { netUsdt: 5 },
                }),
            ],
        });

        // -maxDownPct/100 per position → {0.10, 0.04}
        expect(metrics.maxFloatingDrawdown.max).toBeCloseTo(0.1, 3);
        expect(metrics.maxFloatingDrawdown.avg).toBeCloseTo(0.07, 3);
        // -maxDownUsdt per position → {20, 10}
        expect(metrics.maxFloatingDrawdownUsdt.max).toBeCloseTo(20, 3);
        expect(metrics.maxFloatingDrawdownUsdt.avg).toBeCloseTo(15, 3);
        // mean total = 990 → -maxDownUsdt/990 → {20/990, 10/990}
        expect(metrics.maxPortfolioDrawdown.max).toBeCloseTo(20 / 990, 3);
        expect(metrics.maxPortfolioDrawdown.avg).toBeCloseTo(15 / 990, 3);
    });

    it("tracks spendable-empty durations and trade evenness", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [
                    snapshot(T0, 1000),
                    snapshot(T0 + 5 * DAY, 1000, { spendable: 0 }),
                    snapshot(T0 + 15 * DAY, 1000, { spendable: 0 }),
                    snapshot(T0 + 20 * DAY, 1000),
                ],
            },
            positions: [
                createTestPosition({ closed: { feeUsdt: 0, price: 1, reason: "FINAL", t: T0 + DAY }, symbol: "AAA" }),
                createTestPosition({ closed: { feeUsdt: 0, price: 1, reason: "FINAL", t: T0 + DAY }, symbol: "AAA" }),
                createTestPosition({ closed: { feeUsdt: 0, price: 1, reason: "FINAL", t: T0 + DAY }, symbol: "BBB" }),
            ],
        });

        // empty observed at +5d and +15d, first non-empty at +20d → 15d run
        expect(metrics.emptyBalance.max).toBe(15 * DAY);
        expect(metrics.emptyBalance.min).toBe(15 * DAY);
        // counts {AAA:2, BBB:1}: mean 1.5, cv = 0.33 → exp(-0.33) ≈ 0.72
        expect(metrics.balanceTradesScore).toBeCloseTo(Math.exp(-1 / 3), 2);
    });

    it("aggregates each day's worst floating USD across open positions", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [snapshot(T0, 1000), snapshot(T0 + 3 * DAY, 1000)],
            },
            positions: [
                createTestPosition({
                    entryTime: T0,
                    closed: { feeUsdt: 0, price: 10, reason: "FINAL", t: T0 + 2 * DAY },
                    pnl: {
                        history: [
                            { t: T0 + 3600_000, pct: -3, usdt: -30 },
                            { t: T0 + 2 * 3600_000, pct: -1, usdt: -10 },
                            { t: T0 + DAY + 3600_000, pct: -1, usdt: -10 },
                        ],
                    },
                }),
                // Same day as the first position's -30 dip → day0 sums to -80.
                createTestPosition({
                    entryTime: T0,
                    closed: { feeUsdt: 0, price: 10, reason: "FINAL", t: T0 + DAY },
                    pnl: { history: [{ t: T0 + 3 * 3600_000, pct: -5, usdt: -50 }] },
                }),
                // Winning day-0 position contributes 0 (losses-only clamp).
                createTestPosition({
                    entryTime: T0,
                    closed: { feeUsdt: 0, price: 10, reason: "FINAL", t: T0 + DAY },
                    pnl: { history: [{ t: T0 + 3600_000, pct: 1, usdt: 5 }] },
                }),
            ],
        });

        // day0: -30 + -50 + 0 → 80 ; day1: -10 → 10
        expect(metrics.dailyFloatingDrawdownUsdt?.avg).toBeCloseTo(45, 6);
        expect(metrics.dailyFloatingDrawdownUsdt?.max).toBeCloseTo(80, 6);
        expect(metrics.dailyFloatingDrawdownUsdt?.min).toBeCloseTo(10, 6);
    });

    it("reconstructs floating USD from pct x notional for older pct-only points", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [snapshot(T0, 1000), snapshot(T0 + DAY, 1000)],
            },
            positions: [
                createTestPosition({
                    entryTime: T0,
                    marginUsdt: 100,
                    leverage: 2,
                    closed: { feeUsdt: 0, price: 10, reason: "FINAL", t: T0 + DAY },
                    // Non-finite usdt (legacy/pct-only point) — falls back to
                    // openBase x pct: 200 x -5%.
                    pnl: {
                        history: [
                            { t: T0 + 3600_000, pct: -5, usdt: Number.NaN },
                        ],
                    },
                }),
            ],
        });

        expect(metrics.dailyFloatingDrawdownUsdt?.avg).toBeCloseTo(10, 6);
    });

    it("scores bear-window resilience from vPoint price series", () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: {
                acc1: [
                    snapshot(T0, 1000),
                    snapshot(T0 + 5 * DAY, 900),
                    snapshot(T0 + 10 * DAY, 950),
                    snapshot(T0 + 15 * DAY, 1100),
                ],
            },
            positions: [],
            vPointsMap: {
                AAA: [
                    vPoint(T0, 100),
                    vPoint(T0 + 5 * DAY, 70), // 30% drawdown → bear window [T0, T0+5d]
                    vPoint(T0 + 10 * DAY, 85),
                    vPoint(T0 + 15 * DAY, 110),
                ],
            },
        });

        expect(metrics.bearMarketProofRatio).toBeGreaterThan(0);
        expect(metrics.bearMarketProofRatio).toBeLessThanOrEqual(100);
    });
});

describe("backtest leaderboards store", () => {
    afterAll(async () => {
        await fs.remove(TEST_DIR);
    });

    it("saves, lists, and removes entries keyed by content hash", async () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: { acc1: [snapshot(T0, 1000), snapshot(T0 + DAY, 1010)] },
            positions: [],
        });
        const entry = await leaderboardsStore.save({
            backtestConfig: { range: "1month", settings: { marker: 1 } },
            label: "run-a",
            leaderboard: metrics,
        });

        expect(entry.id).toMatch(/^[0-9a-f]{12}$/);
        const filePath = path.join(TEST_DIR, "results", `${entry.id}.json`);
        expect(await fs.pathExists(filePath)).toBe(true);

        const entries = await leaderboardsStore.list();
        expect(entries.map((e) => e.id)).toContain(entry.id);
        expect(entries.find((e) => e.id === entry.id)?.label).toBe("run-a");

        // Same config + cacheKey → same id (overwrite, not duplicate).
        const again = await leaderboardsStore.save({
            backtestConfig: { range: "1month", settings: { marker: 1 } },
            label: "run-a-v2",
            leaderboard: metrics,
        });
        expect(again.id).toBe(entry.id);
        expect(
            (await leaderboardsStore.list()).filter((e) => e.id === entry.id),
        ).toHaveLength(1);

        expect(await leaderboardsStore.remove(entry.id)).toBe(true);
        expect(await leaderboardsStore.remove(entry.id)).toBe(false);
    });

    it("toggles the favorite flag on the stored entry file", async () => {
        const metrics = computeLeaderboardMetrics({
            balanceSnapshots: { acc1: [snapshot(T0, 1000), snapshot(T0 + DAY, 1010)] },
            positions: [],
        });
        const entry = await leaderboardsStore.save({
            backtestConfig: { range: "1month", settings: { marker: 2 } },
            leaderboard: metrics,
        });
        expect(entry.favorite).toBeUndefined();

        const favored = await leaderboardsStore.setFavorite(entry.id, true);
        expect(favored?.favorite).toBe(true);
        expect(
            (await leaderboardsStore.list()).find((e) => e.id === entry.id)
                ?.favorite,
        ).toBe(true);

        // Unfavoriting drops the key from the file to keep storage compact.
        const cleared = await leaderboardsStore.setFavorite(entry.id, false);
        expect(cleared?.favorite).toBeUndefined();
        const raw = await fs.readJson(
            path.join(TEST_DIR, "results", `${entry.id}.json`),
        );
        expect("favorite" in raw).toBe(false);

        expect(await leaderboardsStore.setFavorite("000000000000", true)).toBeNull();
        await leaderboardsStore.remove(entry.id);
    });
});
