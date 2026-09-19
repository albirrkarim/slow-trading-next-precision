"use client";

import SettingsDialog from "@/components/LiveDashboard/Navbar/Settings/SettingsDialog";
import {
    type ConfigDraftSetter,
    type DashboardState,
} from "@/components/LiveDashboard/Navbar/navbar-types";
import { makeConfigDraft } from "@/components/LiveDashboard/Navbar/Settings/helpers";
import { endpoints } from "@/components/endpoints";
import { TIME_RANGE } from "@/components/constants";
import CoinMultiSelect from "@/components/ui/CoinMultiSelect";
import {
    Box,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
} from "@mui/material";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import axios from "axios";
import HeaderMetrics from "../Evaluation/HeaderMetrics";
import type { BacktestConfig } from "./types";

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
    mode: "volatility_point",

    // Data
    symbols: [],
    range: "1year",
    startTime: undefined,
    endTime: undefined,
    upToDateKlines: false,
    upToDateDecisionBacktest: false,

    // Info
    name: "Example Name",
    description: "",

    // Starting point
    startingBalanceUSDT: 400,

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
    // top-level view setters
    const handleChange = (key: keyof BacktestConfig, value: any) => {
        setBacktestConfig((prev) => ({ ...prev, [key]: value }));
    };

    const handleSymbolsChange = (value: string[]) => {
        handleChange("symbols", value);
    };

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
                return typeof value === "function" ? value(current) ?? current : value ?? current;
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

    return (
        <Box
            sx={{
                backgroundColor: "white",
                borderRadius: "6px",
                p: 1,
                display: "flex",
            }}
        >
            <HeaderMetrics
                title={
                    <TextField
                        label="Config name (optional)"
                        fullWidth
                        sx={{
                            minWidth: "500px",
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

            <CoinMultiSelect
                value={backtestConfig.symbols}
                onChange={handleSymbolsChange}
                showLength={3}
            />

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
                    setConfigDraft={setTradingConfig}
            // dashboardState={dashboardState}
            // onCloseDialog={onSettingsDialogClose}
            // onOpenDialog={onSettingsDialogOpen}
            // onReinitialize={onReinitialize}
            // reinitializing={reinitializing}
            // resetSandbox={resetSandbox}
            // resettingSandboxAccount={resettingSandboxAccount}
            // saveConfig={saveConfig}
            // savingConfig={savingConfig}

            // syncOnlineStorageToLocal={syncOnlineStorageToLocal}
            // syncingOnlineStorage={syncingOnlineStorage}
            // tryWithdrawNow={tryWithdrawNow}
            // tryingWithdraw={tryingWithdraw}
                />
            )}
        </Box>
    );
}
