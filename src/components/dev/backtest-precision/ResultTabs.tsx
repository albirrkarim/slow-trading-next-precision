"use client";

import { Box, Tab, Tabs } from "@mui/material";
import { useEffect, useState } from "react";

import type { BacktestPrecisionResponse } from "@/lib/dev/backtestPrecision/api/precision-api-types";

import type { useBacktestArtifacts } from "./use-backtest-artifacts";
import BacktestBalanceChart from "./BalanceChart";
import BacktestDailyPnlCalendar from "./DailyPnlCalendar";
import DatasetTab from "./DatasetTab";
import MonteCarloTab from "./MonteCarloTab";
import type { BacktestConfig } from "./types";
import VPointsResult from "./VPointsResult";

type ResultTab = "dataset" | "monteCarlo" | "result";
const tabStorageKey = "precision-backtest-result-tab";

/** Restores the last selected result view from browser storage. */
function readTab(): ResultTab {
    try {
        const stored = window.localStorage.getItem(tabStorageKey);
        return stored === "dataset" || stored === "monteCarlo" ? stored : "result";
    } catch { return "result"; }
}

/**
 * Result-area tab switcher: the backtest report sections stay on the first
 * tab; the second hosts the captured feature-gate dataset plus the gate
 * evaluation form.
 */
export default function ResultTabs({
    artifacts,
    backtestConfig,
    data,
}: {
    artifacts: ReturnType<typeof useBacktestArtifacts>;
    backtestConfig: BacktestConfig;
    data: BacktestPrecisionResponse | null;
}) {
    const [tab, setTab] = useState<ResultTab>("result");

    useEffect(() => {
        const timer = window.setTimeout(() => setTab(readTab()), 0);
        return () => window.clearTimeout(timer);
    }, []);

    const changeTab = (next: ResultTab) => {
        setTab(next);
        try { window.localStorage.setItem(tabStorageKey, next); } catch { /* Storage can be unavailable. */ }
    };

    return (
        <Box>
            <Tabs
                aria-label="Backtest result views"
                onChange={(_, next: ResultTab) => changeTab(next)}
                sx={{
                    bgcolor: "action.hover",
                    borderBottom: 1,
                    borderColor: "divider",
                    minHeight: 36,
                    px: 1,
                    "& .MuiTab-root": {
                        borderRadius: "6px 6px 0 0",
                        minHeight: 36,
                        minWidth: "auto",
                        px: { xs: 1, sm: 2 },
                    },
                    "& .MuiTab-root.Mui-selected": {
                        bgcolor: "background.paper",
                    },
                }}
                value={tab}
            >
                <Tab label="Backtest result" value="result" />
                <Tab label="Dataset" value="dataset" />
                <Tab label="Monte Carlo" value="monteCarlo" />
            </Tabs>

            {tab === "result" && data && (
                <Box sx={{ m: 1 }}>
                    <BacktestDailyPnlCalendar
                        positions={artifacts.positions}
                        settings={backtestConfig.settings}
                    />
                    {data.counts.snapshots > 0 && (
                        <BacktestBalanceChart
                            accounts={backtestConfig.settings?.accounts}
                            snapshots={artifacts.snapshots}
                        />
                    )}
                </Box>
            )}
            {tab === "result" && data && (
                <VPointsResult
                    accounts={backtestConfig.settings?.accounts}
                    artifacts={artifacts}
                    blackSwanTimeline={data.blackSwanTimeline}
                    counts={data.counts}
                    datasetEndTimeMs={data.dataset?.endTime}
                    datasetStartTimeMs={data.dataset?.startTime}
                    exchangeType={data.exchangeType}
                    settings={backtestConfig.settings}
                    summary={data.summary}
                />
            )}

            {tab === "dataset" && <DatasetTab cacheKey={data?.cacheKey} />}
            {tab === "monteCarlo" && data && (
                <MonteCarloTab
                    accounts={backtestConfig.settings?.accounts}
                    positions={artifacts.positions}
                />
            )}
        </Box>
    );
}
