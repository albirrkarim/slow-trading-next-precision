"use client";

import SettingsDialog from "@/components/LiveDashboard/Navbar/Settings/SettingsDialog";
import { type ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";
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
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
    modelConfig: {},
};

interface BacktestConfigProps {
    backtestConfig: BacktestConfig;
    setBacktestConfig: Dispatch<SetStateAction<BacktestConfig>>;
}

export default function DynamicBacktestConfig({
    backtestConfig,
    setBacktestConfig,
}: BacktestConfigProps) {
    const [modelConfig, setModelConfig] = useState<ConfigDraft | null>(null);

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

    const updateModelConfig = (patch: ConfigDraft) => {
        setBacktestConfig((prev) => ({
            ...prev,
            modelConfig: {
                ...prev.modelConfig,
                ...patch,
            },
        }));
    };

    useEffect(() => {
        if (modelConfig) {
            updateModelConfig(modelConfig);
        }
    }, [modelConfig]);

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

            <SettingsDialog
                configDraft={backtestConfig.modelConfig}
                setConfigDraft={setModelConfig}
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
        </Box>
    );
}
