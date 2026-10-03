"use client";

import {
    Stack
} from "@mui/material";

import SettingsGroup from "../../Components/SettingsGroup";
import SettingsInfoField from "../../Components/SettingsInfoField";
import type { DashboardState } from "../../settings-types";
import type { Dispatch, SetStateAction } from "react";
import ExitStrategyReference from "../ExitStrategyReference";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

import { AveragingSection } from "./AveragingSection";
import { EntrySection } from "./EntrySection";

interface SettingsDialogTradingTabProps {
    tradingConfig: RuntimeAccountTradingConfig;
    dashboardState?: DashboardState;
    setTradingConfig: Dispatch<SetStateAction<RuntimeAccountTradingConfig>>;
}


export default function TradingAccountSettings({
    tradingConfig,
    dashboardState,
    setTradingConfig,
}: SettingsDialogTradingTabProps) {
    return (
        <Stack gap={3} sx={{ minWidth: 0 }}>
            <SettingsInfoField
                fullWidth
                info="Private notes for remembering this account's strategy. Notes are saved with this account's Trading configuration and do not affect execution."
                label="Strategy Notes"
                maxRows={8}
                minRows={3}
                multiline
                onChange={(event) => {
                    const notes = event.target.value;
                    setTradingConfig((prev) => ({ ...prev, notes }));
                }}
                placeholder="Describe the strategy and why these settings were chosen..."
                size="small"
                value={tradingConfig.notes}
            />
            <EntrySection
                setTradingConfig={setTradingConfig}
                tradingConfig={tradingConfig}
            />
            <AveragingSection
                setTradingConfig={setTradingConfig}
                tradingConfig={tradingConfig}
            />
            <SettingsGroup title="Exit">
                <ExitStrategyReference
                    tradingConfig={tradingConfig}
                    defaultAdverseDriftPct={
                        dashboardState ? dashboardState.globalConfig.volatilityThresholdPct : VOLATILITY_THRESHOLD
                    }
                    setTradingConfig={setTradingConfig}
                />
            </SettingsGroup>
        </Stack>
    );
}
