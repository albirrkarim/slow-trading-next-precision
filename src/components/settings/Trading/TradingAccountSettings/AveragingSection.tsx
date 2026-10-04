"use client";

import { adaptiveAveraging  } from "@/lib/system/trading";

import {
    Grid,
    Typography
} from "@mui/material";

import SettingsCheckbox from "../../Components/SettingsCheckbox";
import SettingsGroup from "../../Components/SettingsGroup";
import SettingsInfoField from "../../Components/SettingsInfoField";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

export function AveragingSection({
    tradingConfig,
    setTradingConfig,
}: {
    tradingConfig: RuntimeAccountTradingConfig;
    setTradingConfig: Dispatch<SetStateAction<RuntimeAccountTradingConfig>>;
}) {
    const averagingEnabled = tradingConfig.enableWatchLogic ?? false;
    const adaptiveConfig = adaptiveAveraging.config.normalize(
        tradingConfig.adaptiveAveraging,
        false,
    );
    return (
        <SettingsGroup
            title={
                <SettingsCheckbox
                    checked={averagingEnabled}
                    info="Master switch for automatic watch/add-position averaging. When disabled, PRECISION skips averaging and the settings in this section are inactive."
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
                <Grid size={{ xs: 12 }}>
                    <Typography color="text.secondary" variant="overline">
                        Levels & Reserve
                    </Typography>
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
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

                <Grid size={{ xs: 12, md: 4 }}>
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

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Guards
                    </Typography>
                </Grid>

                <Grid
                    size={{ xs: 12, md: 6 }}
                    sx={{ alignItems: "center", display: "flex" }}
                >
                    <SettingsCheckbox
                        checked={tradingConfig.entrySpareBufferEnabled ?? true}
                        disabled={!averagingEnabled}
                        info="When ON, entry sizing leaves one additional entry-margin unit spendable after paying for the entry and its reserved averaging steps. It is not locked or reserved. Example: with 210 USDT, one 2x reserve, and no other limit, PRECISION fits floor(210 / (1x entry + 2x reserve + 1x spare)) = 52 USDT. Turn OFF to fit only the entry and reserved steps; the separate largest-UNRESERVED bailout guard still applies."
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
                <Grid
                    size={{ xs: 12, md: 6 }}
                    sx={{ alignItems: "center", display: "flex" }}
                >
                    <SettingsCheckbox
                        checked={
                            tradingConfig.averagingRescueProjectionGuardEnabled ??
                            true
                        }
                        disabled={!averagingEnabled}
                        info="When ON, an averaging attempt must improve the weighted entry and reach the projected rescue-profit target. When OFF, failure of that projection does not block the normal watch-step margin."
                        label="Averaging Rescue Projection Guard"
                        onChange={(checked) =>
                            setTradingConfig((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        averagingRescueProjectionGuardEnabled:
                                            checked,
                                    }
                                    : prev,
                            )
                        }
                    />
                </Grid>

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Adaptive
                    </Typography>
                </Grid>

                <Grid
                    size={{ xs: 12, md: 4 }}
                    sx={{ alignItems: "center", display: "flex" }}
                >
                    <SettingsCheckbox
                        checked={adaptiveConfig.enabled}
                        disabled={!averagingEnabled}
                        info="When ON, PRECISION can raise the averaging multiplier above the reserve multiplier when enough spendable balance exists and the configured projected-profit target can be reached."
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
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
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

                <Grid size={{ xs: 12, md: 4 }}>
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
    );
}
