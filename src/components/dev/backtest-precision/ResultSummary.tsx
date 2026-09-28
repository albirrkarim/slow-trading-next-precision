"use client";

import { useMemo } from "react";

import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type {
    BacktestExitBuckets,
    BacktestReasonCount,
    BacktestRunSummary,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";

type ExitReasonSlice = BacktestReasonCount;

const EMPTY_BUCKETS: BacktestExitBuckets = {
    loss: [],
    lossCoins: [],
    profit: [],
    profitCoins: [],
};

function ExitReasonPie(props: { data: ExitReasonSlice[]; title: string }) {
    const { data, title } = props;
    return (
        <Box sx={{ flex: "1 1 320px", minWidth: 260 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {title}
            </Typography>
            {data.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                    No exits.
                </Typography>
            ) : (
                <>
                    <Box sx={{ height: 200, minWidth: 0 }}>
                        <ResponsiveContainer
                            height="100%"
                            minWidth={0}
                            width="100%"
                        >
                            <PieChart>
                                <Pie
                                    data={data}
                                    dataKey="count"
                                    nameKey="reason"
                                    outerRadius="85%"
                                    paddingAngle={2}
                                >
                                    {data.map((item, index) => (
                                        <Cell
                                            fill={
                                                DEFAULT_COLORS[
                                                index %
                                                DEFAULT_COLORS.length
                                                ]
                                            }
                                            key={item.reason}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                    </Box>
                    <Box
                        sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 1,
                        }}
                    >
                        {data.map((item, index) => (
                            <Box
                                key={item.reason}
                                sx={{
                                    alignItems: "center",
                                    display: "flex",
                                    gap: 0.5,
                                }}
                            >
                                <Box
                                    sx={{
                                        bgcolor:
                                            DEFAULT_COLORS[
                                            index %
                                            DEFAULT_COLORS.length
                                            ],
                                        flexShrink: 0,
                                        height: 12,
                                        width: 12,
                                    }}
                                />
                                <Typography variant="caption">
                                    {item.reason}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                </>
            )}
        </Box>
    );
}

/**
 * Backtest outcome summary: per-account realized PNL against the starting
 * balance, plus exit-reason pie charts split into profit and loss buckets.
 * Aggregates arrive precomputed with the run response — no position arrays
 * are needed in the client.
 */
export default function BacktestResultSummary(props: {
    accounts?: Array<{ name?: string; slug: string }>;
    summary: BacktestRunSummary;
}) {
    const { accounts, summary } = props;
    const nameBySlug = useMemo(
        () =>
            new Map(
                (accounts ?? []).map((account) => [account.slug, account.name]),
            ),
        [accounts],
    );
    const rows = summary.accounts;

    /** Wins/losses per account from the tracked run aggregates. */
    const winLossByAccount = useMemo(
        () =>
            new Map(
                summary.accounts.map((row) => [
                    row.slug,
                    { wins: row.wins, losses: row.losses },
                ]),
            ),
        [summary],
    );

    const totals = useMemo(() => {
        const winLoss = { wins: 0, losses: 0 };
        let start = 0;
        let pnlUsdt = 0;
        for (const row of rows) {
            start += row.start;
            pnlUsdt += row.pnlUsdt;
            const entry = winLossByAccount.get(row.slug);
            winLoss.wins += entry?.wins ?? 0;
            winLoss.losses += entry?.losses ?? 0;
        }
        return {
            ...winLoss,
            pnlUsdt,
            gainPct: start > 0 ? (pnlUsdt / start) * 100 : null,
        };
    }, [rows, winLossByAccount]);

    // Account slugs in configured order, then any extras seen in the run.
    const accountSlugs = useMemo(() => {
        const seen = new Set([
            ...summary.accounts.map((row) => row.slug),
            ...Object.keys(summary.exits),
        ]);
        const ordered = (accounts ?? [])
            .map((account) => account.slug)
            .filter((slug) => seen.delete(slug));
        return [...ordered, ...seen];
    }, [accounts, summary]);

    const slicesByAccount = useMemo(
        () =>
            accountSlugs.map((slug) => ({
                slug,
                ...(summary.exits[slug] ?? EMPTY_BUCKETS),
            })),
        [accountSlugs, summary],
    );

    if (rows.length === 0 && accountSlugs.length === 0) {
        return null;
    }

    return (
        <>
            <HeaderMetrics
                defaultExpanded
                rememberExpand="backtest-precision:account-pnl"
                title={
                    <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                        Total PNL per account
                    </Typography>
                }
            >
                {(expanded) => expanded && (
                    <Table size="small" sx={{ maxWidth: 720 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell>Account</TableCell>
                                <TableCell align="right">PNL (USDT)</TableCell>
                                <TableCell align="right">Gain</TableCell>
                                <TableCell align="right">Win Rate</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => {
                                const winLoss = winLossByAccount.get(row.slug);
                                const closedCount =
                                    (winLoss?.wins ?? 0) + (winLoss?.losses ?? 0);
                                const winRatePct =
                                    closedCount > 0
                                        ? ((winLoss?.wins ?? 0) / closedCount) *
                                        100
                                        : null;
                                return (
                                    <TableRow key={row.slug}>
                                        <TableCell>
                                            {nameBySlug.get(row.slug)?.trim() ||
                                                row.slug}
                                        </TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{
                                                color:
                                                    row.pnlUsdt >= 0
                                                        ? "success.main"
                                                        : "error.main",
                                                fontWeight: 700,
                                            }}
                                        >
                                            {row.pnlUsdt >= 0 ? "+" : ""}
                                            {row.pnlUsdt.toFixed(2)}
                                        </TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{
                                                color:
                                                    row.pnlUsdt >= 0
                                                        ? "success.main"
                                                        : "error.main",
                                                fontWeight: 700,
                                            }}
                                        >
                                            {row.gainPct === null
                                                ? "—"
                                                : `${row.gainPct >= 0 ? "+" : ""}${row.gainPct.toFixed(2)}%`}
                                        </TableCell>
                                        <TableCell align="right">
                                            {winRatePct === null ? (
                                                "—"
                                            ) : (
                                                <>
                                                    <b>
                                                        {winRatePct.toFixed(1)}%
                                                    </b>{" "}
                                                    <Typography
                                                        color="text.secondary"
                                                        component="span"
                                                        variant="caption"
                                                    >
                                                        {winLoss?.wins ?? 0}W·
                                                        {winLoss?.losses ?? 0}L·
                                                        {closedCount}T
                                                    </Typography>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {rows.length > 1 && (
                                <TableRow
                                    sx={{
                                        "& td": {
                                            borderTop: 2,
                                            borderColor: "divider",
                                            fontWeight: 700,
                                        },
                                    }}
                                >
                                    <TableCell>All</TableCell>
                                    <TableCell
                                        align="right"
                                        sx={{
                                            color:
                                                totals.pnlUsdt >= 0
                                                    ? "success.main"
                                                    : "error.main",
                                        }}
                                    >
                                        {totals.pnlUsdt >= 0 ? "+" : ""}
                                        {totals.pnlUsdt.toFixed(2)}
                                    </TableCell>
                                    <TableCell
                                        align="right"
                                        sx={{
                                            color:
                                                totals.pnlUsdt >= 0
                                                    ? "success.main"
                                                    : "error.main",
                                        }}
                                    >
                                        {totals.gainPct === null
                                            ? "—"
                                            : `${totals.gainPct >= 0 ? "+" : ""}${totals.gainPct.toFixed(2)}%`}
                                    </TableCell>
                                    <TableCell align="right">
                                        {totals.wins + totals.losses === 0 ? (
                                            "—"
                                        ) : (
                                            <>
                                                <b>
                                                    {(
                                                        (totals.wins /
                                                            (totals.wins +
                                                                totals.losses)) *
                                                        100
                                                    ).toFixed(1)}
                                                    %
                                                </b>{" "}
                                                <Typography
                                                    color="text.secondary"
                                                    component="span"
                                                    variant="caption"
                                                >
                                                    {totals.wins}W·
                                                    {totals.losses}L·
                                                    {totals.wins +
                                                        totals.losses}
                                                    T
                                                </Typography>
                                            </>
                                        )}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </HeaderMetrics>

            <HeaderMetrics
                rememberExpand="backtest-precision:exit-reasons"
                title={
                    <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                        Exit reason counts
                    </Typography>
                }
            >
                {(expanded) => expanded && (
                    <>
                        {accountSlugs.length === 0 && (
                            <Typography color="text.secondary" variant="body2">
                                No positions.
                            </Typography>
                        )}
                        {slicesByAccount.map(
                            ({ slug, profit, loss, profitCoins, lossCoins }) => (
                                <Box key={slug} sx={{ mb: 1.5 }}>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ fontWeight: "bold", mb: 0.5 }}
                                    >
                                        {nameBySlug.get(slug)?.trim() || slug}
                                    </Typography>
                                    <Box
                                        sx={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 2,
                                        }}
                                    >
                                        <ExitReasonPie
                                            data={profit}
                                            title="Profit exits"
                                        />
                                        <ExitReasonPie
                                            data={loss}
                                            title="Loss exits"
                                        />
                                        <ExitReasonPie
                                            data={profitCoins}
                                            title="Profit coins"
                                        />
                                        <ExitReasonPie
                                            data={lossCoins}
                                            title="Loss coins"
                                        />
                                    </Box>
                                </Box>
                            ),
                        )}
                    </>
                )}
            </HeaderMetrics>
        </>
    );
}
