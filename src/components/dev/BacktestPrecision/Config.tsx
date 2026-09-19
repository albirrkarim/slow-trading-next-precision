"use client";

import SettingsDialog from "@/components/LiveDashboard/Navbar/Settings/SettingsDialog";
import {
    type ConfigDraftSetter,
    type DashboardState,
} from "@/components/LiveDashboard/Navbar/navbar-types";
import { makeConfigDraft } from "@/components/LiveDashboard/Navbar/Settings/helpers";
import { endpoints } from "@/components/endpoints";
import { TIME_RANGE } from "@/components/constants";
import {
    Box,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
} from "@mui/material";
import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import axios from "axios";
import HeaderMetrics from "../Evaluation/HeaderMetrics";
import { buildBacktestDashboardState } from "./backtest-dashboard-state";
import type { BacktestConfig } from "./types";

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
    mode: "volatility_point",

    // Data
    range: "1year",
    startTime: undefined,
    endTime: undefined,
    upToDateKlines: false,
    upToDateDecisionBacktest: false,

    // Info
    name: "Example Name",
    description: "",

    // Config
    settings: undefined,
};

interface BacktestConfigProps {
    backtestConfig: BacktestConfig;
    setBacktestConfig: Dispatch<SetStateAction<BacktestConfig>>;
}

export default function DynamicBacktestConfig({
    backtestConfig,
    setBacktestConfig,
}: BacktestConfigProps) {
    // backtest patch helpers
    const updateBacktest = (patch: Partial<BacktestConfig>) => {
        setBacktestConfig((prev) => ({ ...prev, ...patch }));
    };

    const setTradingConfig: ConfigDraftSetter = (value) => {
        setBacktestConfig((prev) => ({
            ...prev,
            settings: (() => {
                const current = prev.settings;
                if (!current) return current;
                return typeof value === "function"
                    ? value(current) ?? current
                    : value ?? current;
            })(),
        }));
    };

    useEffect(() => {
        if (backtestConfig.settings) return undefined;
        const controller = new AbortController();
        void axios
            .get<DashboardState>(endpoints.slow.prod.storage, {
                signal: controller.signal,
            })
            .then((response) => {
                setBacktestConfig((current) =>
                    current.settings
                        ? current
                        : {
                            ...current,
                            settings: makeConfigDraft(response.data),
                        },
                );
            });
        return () => controller.abort();
    }, [backtestConfig.settings, setBacktestConfig]);

    const dashboardState = useMemo(
        () =>
            backtestConfig.settings
                ? buildBacktestDashboardState(backtestConfig.settings)
                : undefined,
        [backtestConfig.settings],
    );

    return (
        <Box
            sx={{
                alignItems: "center",
                backgroundColor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 1.5,
                color: "text.primary",
                display: "flex",
                flex: "1 1 680px",
                flexWrap: "wrap",
                gap: 0.75,
                minWidth: 0,
                p: 0.5,
                "& .MuiIconButton-root": {
                    color: "primary.main",
                    minHeight: 40,
                    minWidth: 40,
                },
            }}
        >
            <HeaderMetrics
                sx={{ flex: "1 1 320px", minWidth: 240 }}
                title={
                    <TextField
                        label="Config name (optional)"
                        fullWidth
                        sx={{
                            minWidth: 0,
                        }}
                        size="small"
                        value={backtestConfig.name ?? ""}
                        onChange={(e) => updateBacktest({ name: e.target.value })}
                        placeholder="e.g. 'SLOW Aggressive 2025'"
                    />
                }
            >
                {(expand) => (
                    <>
                        {expand && (
                            <TextField
                                label="Description (optional)"
                                fullWidth
                                size="small"
                                value={backtestConfig.description ?? ""}
                                onChange={(e) =>
                                    updateBacktest({ description: e.target.value })
                                }
                                placeholder="Short notes about this config"
                            />
                        )}
                    </>
                )}
            </HeaderMetrics>

            <FormControl size="small" sx={{ width: 112 }}>
                <InputLabel>Range</InputLabel>
                <Select
                    value={backtestConfig.range}
                    label="Range"
                    onChange={(e) => {
                        updateBacktest({
                            range: e.target.value,
                            startTime: undefined,
                            endTime: undefined,
                        });
                    }}
                    size="small"
                >
                    {TIME_RANGE.map((item) => (
                        <MenuItem key={item} value={item}>
                            {item}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {backtestConfig.settings && (
                <SettingsDialog
                    configDraft={backtestConfig.settings}
                    dashboardState={dashboardState}
                    hiddenTabs={["notification", "withdraw", "mcp"]}
                    setConfigDraft={setTradingConfig}
                />
            )}
        </Box>
    );
}
