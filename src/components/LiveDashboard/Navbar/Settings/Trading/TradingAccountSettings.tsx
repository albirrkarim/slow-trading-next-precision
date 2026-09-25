"use client";

import { adaptiveAveraging  } from "@/lib/system/trading";

import {
    Grid,
    Stack
} from "@mui/material";

import SettingsCheckbox from "../Components/SettingsCheckbox";
import SettingsGroup from "../Components/SettingsGroup";
import SettingsInfoField from "../Components/SettingsInfoField";
import type { DashboardState } from "../settings-types";
import type { Dispatch, SetStateAction } from "react";
import ExitStrategyReference from "./ExitStrategyReference";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";


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
    const averagingEnabled = tradingConfig.enableWatchLogic ?? false;
    const adaptiveConfig = adaptiveAveraging.config.normalize(
        tradingConfig.adaptiveAveraging,
        false,
    );
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
            <SettingsGroup title="Entry">
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                        <SettingsCheckbox
                            checked={
                                tradingConfig.lateEntryVPointPriceDriftEnabled !== false
                            }
                            info="Automatic entries: block when the latest closed 1-minute price has moved more than the limit in the trade's profitable direction from the signal vPoint (above it for LONG, below for SHORT). The limit is 0.5% when the volatility threshold is below 5%; otherwise it is 1%. For a vPoint price of 100 and a 1% limit, LONG above 101 or SHORT below 99 is blocked; exactly 101 or 99 is allowed. Checked when selecting a signal and again before execution. Adverse moves and manual entries are exempt. Applies only to this account in live, sandbox, and backtest."
                            infoTooltipMaxWidth={440}
                            label="Late Entry vPoint Price Drift Guard"
                            onChange={(checked) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            lateEntryVPointPriceDriftEnabled: checked,
                                        }
                                        : prev,
                                )
                            }
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Min Entry Absolute Level"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.minEntryAbsLevel ?? ""}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            minEntryAbsLevel: event.target.value === ""
                                                ? undefined
                                                : Math.max(0, Math.floor(Number(event.target.value))),
                                        }
                                        : prev,
                                )
                            }
                            slotProps={{
                                htmlInput: {
                                    step: "1",
                                    inputMode: "numeric",
                                    min: 0,
                                },
                            }}
                            info="Inclusive minimum absolute vPoint level for a new entry. Clear the field to disable this bound. New accounts start at 2; 0 is an active minimum."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Entry Absolute Level"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxEntryAbsLevel ?? ""}
                            onChange={(event) =>
                                setTradingConfig((prev) => ({
                                    ...prev,
                                    maxEntryAbsLevel: event.target.value === ""
                                        ? undefined
                                        : Math.max(0, Math.floor(Number(event.target.value))),
                                }))
                            }
                            slotProps={{
                                htmlInput: {
                                    step: "1",
                                    inputMode: "numeric",
                                    min: 0,
                                },
                            }}
                            info="Inclusive maximum absolute vPoint level for a new entry. Clear the field to disable this bound. A value of 0 permits only level 0; a maximum below the minimum permits no entries."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Open Positions"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxOpenPositions ?? 0}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            maxOpenPositions: Math.max(
                                                0,
                                                Math.floor(Number(event.target.value) || 0),
                                            ),
                                        }
                                        : prev,
                                )
                            }
                            slotProps={{
                                htmlInput: {
                                    step: "1",
                                    inputMode: "numeric",
                                    min: 0,
                                },
                            }}
                            info="Maximum number of positions that may be open at once in the active mode. Set 0 to disable this guard."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Entry 24h Vol %"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxEntryBased24HourVolPct ?? 0.2}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            maxEntryBased24HourVolPct: Number(
                                                event.target.value,
                                            ),
                                        }
                                        : prev,
                                )
                            }
                            info="Liquidity cap for entry sizing. Example: 24h quote volume 1,000,000 and value 0.2 means SLOW sizes entry + reserves inside a temporary 2,000 USDT budget. The real spendable balance above that stays untouched. Set 0 to disable."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Entry Margin %"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxEntryMarginPct ?? 0}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            maxEntryMarginPct: Number(event.target.value),
                                        }
                                        : prev,
                                )
                            }
                            info="Maximum percent of spendable balance that one entry plus its reserve may consume. Example: spendable 1,000 and cap 20 means entry + reserved averaging cannot exceed 200. Set 0 to disable."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Entry Margin (USDT)"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxEntryMargin ?? 0}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            maxEntryMargin: Number(event.target.value),
                                        }
                                        : prev,
                                )
                            }
                            info="Hard USDT cap for one entry margin. Example: engine wants 80 USDT but this is 50, so SLOW uses at most 50. Set 0 to use engine calculation."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Max Leverage"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.maxLeverage ?? 0}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? { ...prev, maxLeverage: Number(event.target.value) }
                                        : prev,
                                )
                            }
                            info="Maximum futures leverage allowed. Example: engine chooses 5x but this is 3, so the order is capped at 3x. Set 0 to use engine calculation."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            label="Exact Leverage"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.exactLeverage ?? 0}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            exactLeverage: Math.max(
                                                0,
                                                Math.floor(Number(event.target.value) || 0),
                                            ),
                                        }
                                        : prev,
                                )
                            }
                            slotProps={{
                                htmlInput: {
                                    step: "1",
                                    inputMode: "numeric",
                                    min: 0,
                                },
                            }}
                            info="Forces every futures entry to use this leverage, overriding the engine and Max Leverage values. Set 0 to use the normal calculation. Spot always uses 1x."
                        />
                    </Grid>
                </Grid>
            </SettingsGroup>

            <SettingsGroup
                title={
                    <SettingsCheckbox
                        checked={averagingEnabled}
                        info="Master switch for automatic watch/add-position averaging. When disabled, SLOW skips averaging and the settings in this section are inactive."
                        label="Averaging"
                        labelFontWeight={700}
                        labelVariant="subtitle1"
                        onChange={(checked) =>
                            setTradingConfig((prev) =>
                                prev ? { ...prev, enableWatchLogic: checked } : prev,
                            )
                        }
                    />
                }
            >
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            disabled={!averagingEnabled}
                            label="Reserve Next Levels"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.watchReserveLevels ?? 2}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            watchReserveLevels: Number(event.target.value),
                                        }
                                        : prev,
                                )
                            }
                            info="How many next averaging steps should reserve balance. Example: current entry level 4 and value 2 means reserve for level 5 and 6 adds. Set 0 to disable."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            disabled={!averagingEnabled}
                            label="Reserve Multiplier"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.watchReservePctAlloc ?? 2}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            watchReservePctAlloc: Number(event.target.value),
                                        }
                                        : prev,
                                )
                            }
                            info="Multiplier for each reserved averaging step. Example: entry margin 10 and multiplier 2 reserves 20 for the first add; if total margin becomes 30, the next reserved add can be 60."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 4 }}>
                        <SettingsInfoField
                            disabled={!averagingEnabled}
                            label="Max Next Averaging Levels"
                            type="number"
                            size="small"
                            fullWidth
                            value={tradingConfig.watchMaxNextAveragingLevels ?? 2}
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            watchMaxNextAveragingLevels: Number(
                                                event.target.value,
                                            ),
                                        }
                                        : prev,
                                )
                            }
                            info="Relative cap for automatic averaging. Example: entry at level 4 and max 2 means watch logic may add on level 5 and 6, but not 7. Set 0 to disable."
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 8 }}>
                        <SettingsCheckbox
                            checked={tradingConfig.entrySpareBufferEnabled ?? true}
                            disabled={!averagingEnabled}
                            info="When ON, entry sizing leaves one additional entry-margin unit spendable after paying for the entry and its reserved averaging steps. It is not locked or reserved. Example: with 210 USDT, one 2x reserve, and no other limit, SLOW fits floor(210 / (1x entry + 2x reserve + 1x spare)) = 52 USDT. Turn OFF to fit only the entry and reserved steps; the separate largest-UNRESERVED bailout guard still applies."
                            label="Spare Entry-Margin Buffer"
                            onChange={(checked) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? { ...prev, entrySpareBufferEnabled: checked }
                                        : prev,
                                )
                            }
                        />
                    </Grid>
                </Grid>

                <SettingsCheckbox
                    checked={
                        tradingConfig.averagingRescueProjectionGuardEnabled ?? true
                    }
                    disabled={!averagingEnabled}
                    info="When ON, an averaging attempt must improve the weighted entry and reach the projected rescue-profit target. When OFF, failure of that projection does not block the normal watch-step margin."
                    label="Averaging Rescue Projection Guard"
                    onChange={(checked) =>
                        setTradingConfig((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    averagingRescueProjectionGuardEnabled: checked,
                                }
                                : prev,
                        )
                    }
                />

                <SettingsCheckbox
                    checked={adaptiveConfig.enabled}
                    disabled={!averagingEnabled}
                    info="When ON, SLOW can raise the averaging multiplier above the reserve multiplier when enough spendable balance exists and the configured projected-profit target can be reached."
                    label="Adaptive Averaging"
                    onChange={(checked) =>
                        setTradingConfig((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    adaptiveAveraging: {
                                        ...adaptiveAveraging.config.normalize(
                                            prev.adaptiveAveraging,
                                            false,
                                        ),
                                        enabled: checked,
                                    },
                                }
                                : prev,
                        )
                    }
                />

                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            disabled={!averagingEnabled || !adaptiveConfig.enabled}
                            fullWidth
                            info="Highest multiplier the adaptive search may try. The normal reserve multiplier is always evaluated first."
                            label="Adaptive Max Multiplier"
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            adaptiveAveraging: {
                                                ...adaptiveAveraging.config.normalize(
                                                    prev.adaptiveAveraging,
                                                    false,
                                                ),
                                                maxMultiplier: Math.max(
                                                    1,
                                                    Math.floor(Number(event.target.value) || 0),
                                                ),
                                            },
                                        }
                                        : prev,
                                )
                            }
                            size="small"
                            slotProps={{
                                htmlInput: { inputMode: "numeric", min: 1, step: "1" },
                            }}
                            type="number"
                            value={adaptiveConfig.maxMultiplier}
                        />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <SettingsInfoField
                            disabled={!averagingEnabled || !adaptiveConfig.enabled}
                            fullWidth
                            info="Minimum projected position profit required at the rescue target anchored to the triggering vPoint."
                            label="Adaptive Minimum Projected Profit %"
                            onChange={(event) =>
                                setTradingConfig((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            adaptiveAveraging: {
                                                ...adaptiveAveraging.config.normalize(
                                                    prev.adaptiveAveraging,
                                                    false,
                                                ),
                                                minProjectedProfitPct: Math.max(
                                                    0,
                                                    Number(event.target.value) || 0,
                                                ),
                                            },
                                        }
                                        : prev,
                                )
                            }
                            size="small"
                            slotProps={{
                                htmlInput: { inputMode: "decimal", min: 0, step: "0.1" },
                            }}
                            type="number"
                            value={adaptiveConfig.minProjectedProfitPct}
                        />
                    </Grid>
                </Grid>
            </SettingsGroup>

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
