"use client";

import type { ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";
import SidebarButton from "@/components/ui/SidebarButton";
import type { BacktestPrecisionParams } from "@/lib/dev/backtestPrecision/api/precision-api-types";
import type { BacktestPrecisionResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { tradeLog } from "@/lib/trading/helper/log";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
    Typography
} from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";
import { delayExecution } from "../../client/utils";
import { endpoints } from "../../endpoints";
import PrecisionBTestConfig, { DEFAULT_BACKTEST_CONFIG } from "./Config";
import type { BacktestConfig } from "./types";
import VPointsResult from "./VPointsResult";

const BACKTEST_KEY = "precision";

type BacktestConfigInput = Partial<BacktestConfig> & {
    config?: Partial<BacktestConfig> | ConfigDraft;
};

type BacktestConfigEnvelope = BacktestConfigInput & {
    backtestConfig?: BacktestConfigInput;
};

export function normalizeBacktestConfig(raw: unknown): BacktestConfig {
    const rawConfig =
        raw && typeof raw === "object" ? (raw as BacktestConfigEnvelope) : {};
    const config: BacktestConfigInput =
        rawConfig.backtestConfig && typeof rawConfig.backtestConfig === "object"
            ? rawConfig.backtestConfig
            : rawConfig;

    const { config: nestedRuntimeConfig, ...outerConfig } = config;
    const runtimeConfig =
        nestedRuntimeConfig && typeof nestedRuntimeConfig === "object"
            ? nestedRuntimeConfig
            : {};
    const groupedSettings =
        "management" in runtimeConfig &&
            "runtime" in runtimeConfig &&
            "accounts" in runtimeConfig
            ? (runtimeConfig as ConfigDraft)
            : undefined;

    return {
        ...DEFAULT_BACKTEST_CONFIG,
        ...outerConfig,
        ...runtimeConfig,
        settings:
            groupedSettings ??
            ("settings" in runtimeConfig ? runtimeConfig.settings : undefined) ??
            outerConfig.settings ??
            DEFAULT_BACKTEST_CONFIG.settings,
    };
}

export default function DynamicTradeAnalytics() {
    const before = localStorage.getItem(BACKTEST_KEY);

    const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>(
        before
            ? normalizeBacktestConfig(JSON.parse(before))
            : DEFAULT_BACKTEST_CONFIG,
    );

    const [data, setData] = useState<BacktestPrecisionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // persist view config to localStorage (existing behavior)
    useEffect(() => {
        delayExecution(() => {
            try {
                localStorage.setItem(BACKTEST_KEY, JSON.stringify(backtestConfig));
            } catch {
                /* ignore */
            }
        }, 1000);
    }, [backtestConfig]);

    // execute backtest & save payload to history after success
    const execute = async (customConfig?: BacktestConfig) => {
        setLoading(true);
        try {
            setData(null);
            setError(null);

            const usedConfig = normalizeBacktestConfig(
                customConfig ?? backtestConfig,
            );

            if (!usedConfig.settings) {
                throw new Error("SLOW settings are still loading.");
            }

            // derive start/end time in ms based on selected range
            const computeRangeMs = (
                range: string,
            ): { startTime: number; endTime: number } => {
                const now = new Date();
                const endTime = now.getTime();
                const match = range.match(/^(\d+)(month|year)$/);
                if (!match) {
                    // fallback to 1year if unknown
                    const fallback = new Date(now);
                    fallback.setFullYear(fallback.getFullYear() - 1);
                    return { startTime: fallback.getTime(), endTime };
                }
                const amount = Number(match[1]);
                const unit = match[2];
                const start = new Date(now);
                if (unit === "month") {
                    start.setMonth(start.getMonth() - amount);
                } else {
                    start.setFullYear(start.getFullYear() - amount);
                }
                return { startTime: start.getTime(), endTime };
            };

            const hasCustomTime =
                typeof usedConfig.startTime === "number" &&
                usedConfig.startTime > 0 &&
                typeof usedConfig.endTime === "number" &&
                usedConfig.endTime > 0;

            const { startTime, endTime } = hasCustomTime
                ? {
                    startTime: usedConfig.startTime as number,
                    endTime: usedConfig.endTime as number,
                }
                : computeRangeMs(usedConfig.range);

            // build payload exactly as requested
            const payload: BacktestPrecisionParams = {
                // BTEST:BACKTEST_MANAGEMENT_SYMBOLS
                range: usedConfig.range,
                startTime,
                endTime,
                upToDateKlines: usedConfig.upToDateKlines,
                upToDateDecisionBacktest: usedConfig.upToDateDecisionBacktest,
                config: usedConfig.settings,
            };

            tradeLog.log("Sending payload:", JSON.stringify(payload, null, 2));

            const resp = await axios.post<BacktestPrecisionResult>(
                endpoints.dev.backtestPrecision.backtest,
                payload,
            );

            setData(resp.data);

            tradeLog.log("VolatilityMap response:", resp.data);
        } catch (e) {
            tradeLog.error(e);
            setError(
                axios.isAxiosError(e)
                    ? (e.response?.data?.error ?? e.message)
                    : e instanceof Error
                        ? e.message
                        : "Execution failed",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box>
            <Box
                component="header"
                sx={{
                    p: 1,
                    display: "flex",
                    gap: 1,
                    alignItems: "center",
                    flexWrap: { xs: "wrap", lg: "nowrap" },
                    backgroundColor: "primary.dark",
                    borderBottom: 1,
                    borderColor: "primary.main",
                    boxShadow: 1,
                    color: "common.white",
                }}
            >
                <Typography
                    component="div"
                    variant="h6"
                    sx={{
                        alignItems: "center",
                        display: "flex",
                        flex: "0 0 auto",
                        fontSize: "1rem",
                        fontWeight: 700,
                        minHeight: 40,
                        whiteSpace: "nowrap",
                    }}
                >
                    <SidebarButton />
                    Backtest Precision · Klines
                </Typography>

                <PrecisionBTestConfig
                    backtestConfig={backtestConfig}
                    setBacktestConfig={setBacktestConfig}
                />

                <Box
                    sx={{
                        p: 0.5,
                        gap: 1,
                        borderRadius: 1.5,
                        display: "flex",
                        flex: { xs: "1 1 100%", lg: "0 0 auto" },
                        backgroundColor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        color: "text.primary",
                    }}
                >
                    <Box
                        sx={{
                            display: "flex",
                            flex: 1,
                            flexWrap: { xs: "wrap", sm: "nowrap" },
                            gap: 0.75,
                            alignItems: "center",
                        }}
                    >
                        {/* regular execute */}
                        <IconButton
                            onClick={() => execute()}
                            disabled={loading}
                            aria-label="Run backtest"
                            title="Run backtest"
                            sx={{
                                bgcolor: "primary.main",
                                color: "primary.contrastText",
                                minHeight: 40,
                                minWidth: 40,
                                "&:hover": { bgcolor: "primary.dark" },
                                "&.Mui-disabled": {
                                    bgcolor: "action.disabledBackground",
                                    color: "action.disabled",
                                },
                            }}
                        >
                            {loading ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                        </IconButton>
                    </Box>
                </Box>
            </Box>

            {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

            {data && <VPointsResult result={data} />}
        </Box>
    );
}
