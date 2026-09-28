"use client";

import type { ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";
import { runtimeNormalize } from "@/lib/system/runtime";
import SidebarButton from "@/components/ui/SidebarButton";
import type {
    BacktestPrecisionParams,
    BacktestPrecisionResponse,
} from "@/lib/dev/backtestPrecision/api/precision-api-types";
import { systemLog } from "@/lib/system/logging";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SaveIcon from "@mui/icons-material/Save";
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
    Snackbar,
    Tooltip,
    Typography
} from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";
import { CopyText } from "@/components/ui/CopyText";
import { delayExecution } from "../../client/utils";
import { endpoints } from "../../endpoints";
import PrecisionBTestConfig, { DEFAULT_BACKTEST_CONFIG } from "./Config";
import BacktestBalanceChart from "./BalanceChart";
import BacktestDailyPnlCalendar from "./DailyPnlCalendar";
import Leaderboards from "./Leaderboards";
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

    const [data, setData] = useState<BacktestPrecisionResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [savingLeaderboard, setSavingLeaderboard] = useState(false);
    const [saveNotice, setSaveNotice] = useState<{
        severity: "error" | "success";
        text: string;
    } | null>(null);

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
                config: runtimeNormalize.config.toRuntime(usedConfig.settings),
            };

            systemLog.log("Sending payload:", JSON.stringify(payload, null, 2));

            const resp = await axios.post<BacktestPrecisionResponse>(
                endpoints.dev.backtestPrecision,
                payload,
            );

            setData(resp.data);

            systemLog.log("VolatilityMap response:", resp.data);
        } catch (e) {
            systemLog.error(e);
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

    /** Persists the current run into storage/leaderboards/<hash>.json. */
    const saveToLeaderboards = async () => {
        if (!data) return;
        setSavingLeaderboard(true);
        setSaveNotice(null);
        try {
            await axios.post(endpoints.dev.backtestPrecisionLeaderboards, {
                backtestConfig,
                cachePath: data.cachePath,
                label:
                    backtestConfig.name ||
                    backtestConfig.description ||
                    backtestConfig.range,
                result: data.cachePath
                    ? undefined
                    : {
                          balanceSnapshots: data.balanceSnapshots,
                          exchangeType: data.exchangeType,
                          positions: data.positions,
                          vPointsMap: data.vPointsMap,
                      },
            });
            setSaveNotice({ severity: "success", text: "Saved to leaderboards." });
        } catch (e) {
            setSaveNotice({
                severity: "error",
                text: axios.isAxiosError(e)
                    ? (e.response?.data?.error ?? e.message)
                    : "Save failed",
            });
        } finally {
            setSavingLeaderboard(false);
        }
    };

    const applySavedConfig = (config: BacktestConfig) => {
        setBacktestConfig(normalizeBacktestConfig(config));
    };

    const runSavedConfig = async (config: BacktestConfig) => {
        applySavedConfig(config);
        await execute(config);
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

                        <Tooltip title="Save run to leaderboards">
                            <span>
                                <IconButton
                                    aria-label="Save to leaderboards"
                                    disabled={!data || savingLeaderboard}
                                    onClick={() => void saveToLeaderboards()}
                                    size="small"
                                >
                                    {savingLeaderboard ? (
                                        <CircularProgress size={18} />
                                    ) : (
                                        <SaveIcon fontSize="small" />
                                    )}
                                </IconButton>
                            </span>
                        </Tooltip>

                        <Leaderboards
                            onApplyConfig={applySavedConfig}
                            onRunConfig={runSavedConfig}
                        />
                    </Box>
                </Box>
            </Box>

            {data?.cachePath && (
                <Box
                    sx={{
                        alignItems: "center",
                        borderBottom: 1,
                        borderColor: "divider",
                        display: "flex",
                        gap: 0.5,
                        px: 1,
                        py: 0.25,
                    }}
                >
                    <Typography
                        component="span"
                        sx={{ fontSize: "0.7rem", fontWeight: 700 }}
                    >
                        {data.cached ? "Cache (reused):" : "Cache:"}
                    </Typography>
                    <Typography
                        component="code"
                        sx={{
                            flex: 1,
                            fontSize: "0.7rem",
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                        title={data.cachePath}
                    >
                        {data.cachePath}
                    </Typography>
                    <CopyText
                        label="backtest cache path"
                        text={data.cachePath}
                        tooltip="Copy cache path"
                        copiedTooltip="Copied"
                    />
                </Box>
            )}

            {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

            {data && (
                <Box sx={{ m: 1 }}>
                    <BacktestDailyPnlCalendar
                        positions={data.positions}
                        settings={backtestConfig.settings}
                    />
                    <BacktestBalanceChart
                        accounts={backtestConfig.settings?.accounts}
                        snapshots={data.balanceSnapshots}
                    />
                </Box>
            )}
            {data && (
                <VPointsResult
                    accounts={backtestConfig.settings?.accounts}
                    result={data}
                />
            )}

            <Snackbar
                anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
                autoHideDuration={4000}
                onClose={() => setSaveNotice(null)}
                open={saveNotice !== null}
            >
                <Alert
                    onClose={() => setSaveNotice(null)}
                    severity={saveNotice?.severity ?? "success"}
                    variant="filled"
                >
                    {saveNotice?.text}
                </Alert>
            </Snackbar>
        </Box>
    );
}
