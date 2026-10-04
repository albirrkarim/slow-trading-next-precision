"use client";

import {
    Alert,
    Grid,
    MenuItem,
    Typography
} from "@mui/material";

import SettingsCheckbox from "../../Components/SettingsCheckbox";
import SettingsGroup from "../../Components/SettingsGroup";
import SettingsInfoField from "../../Components/SettingsInfoField";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

import { ENTRY_LEGS_OPTIONS } from "./options";

export function EntrySection({
    tradingConfig,
    setTradingConfig,
}: {
    tradingConfig: RuntimeAccountTradingConfig;
    setTradingConfig: Dispatch<SetStateAction<RuntimeAccountTradingConfig>>;
}) {
    return (
        <SettingsGroup title="Entry">
            <Grid container spacing={2}>
                <Grid size={{ xs: 12 }}>
                    <Typography color="text.secondary" variant="overline">
                        Drift Guard
                    </Typography>
                </Grid>

                <Grid
                    size={{ xs: 12, md: 6 }}
                    sx={{ alignItems: "center", display: "flex" }}
                >
                    <SettingsCheckbox
                        checked={
                            tradingConfig.lateEntryVPointPriceDriftEnabled !== false
                        }
                        info="Automatic entries: block when the latest closed 1-minute price has moved more than the limit in the trade's profitable direction from the signal vPoint (above it for LONG, below for SHORT). The limit is 0.5% when the volatility threshold is below 5%; otherwise it is 1%. The Drift Limit % field below overrides that automatic limit for this account. For a vPoint price of 100 and a 1% limit, LONG above 101 or SHORT below 99 is blocked; exactly 101 or 99 is allowed. Checked when selecting a signal and again before execution. Adverse moves and manual entries are exempt. Applies only to this account in live, sandbox, and backtest."
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
                        label="Drift Limit %"
                        type="number"
                        size="small"
                        fullWidth
                        value={tradingConfig.lateEntryVPointPriceDriftPct ?? ""}
                        onChange={(event) =>
                            setTradingConfig((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        lateEntryVPointPriceDriftPct:
                                            event.target.value === ""
                                                ? undefined
                                                : Math.max(
                                                    0,
                                                    Number(event.target.value),
                                                ),
                                    }
                                    : prev,
                            )
                        }
                        slotProps={{
                            htmlInput: {
                                min: 0,
                                step: "0.1",
                            },
                        }}
                        info="Optional override of the late-entry price drift cap in percent. Empty keeps the automatic limit (0.5% when the volatility threshold is below 5%, otherwise 1%); 0 blocks any profitable drift. Applies to automatic entries only and is checked when a signal is selected and again before execution."
                    />
                </Grid>

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Forming vPoint Entry
                    </Typography>
                </Grid>

                <Grid
                    size={{ xs: 12, md: 6 }}
                    sx={{ alignItems: "center", display: "flex" }}
                >
                    <SettingsCheckbox
                        checked={
                            tradingConfig.formingVPointEntryEnabled === true
                        }
                        info="Replaces normal entries for this account: entry fires only when the latest vPoint's running excursions qualify a forming direction (↓ ≥ F & ↑ < A → SHORT, ↑ ≥ F & ↓ < A → LONG; if both qualify the larger favorable excursion wins, tie → no entry). Initial entries only; averaging and reserve are disabled for these positions; the late-entry drift guard is skipped; the 0.9 × volatility threshold &quot;might formed&quot; guard still blocks; exits unchanged. Applies to live, sandbox, and backtest."
                        infoTooltipMaxWidth={440}
                        label="Enable Entry Using Forming vPoint"
                        onChange={(checked) =>
                            setTradingConfig((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        formingVPointEntryEnabled: checked,
                                    }
                                    : prev,
                            )
                        }
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 3 }}>
                    <SettingsInfoField
                        label="Favorable %"
                        type="number"
                        size="small"
                        fullWidth
                        value={tradingConfig.formingVPointEntryFavorablePct ?? 3}
                        onChange={(event) =>
                            setTradingConfig((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        formingVPointEntryFavorablePct:
                                            event.target.value === ""
                                                ? undefined
                                                : Math.max(
                                                    0,
                                                    Number(event.target.value),
                                                ),
                                    }
                                    : prev,
                            )
                        }
                        slotProps={{
                            htmlInput: {
                                min: 0,
                                step: "0.1",
                            },
                        }}
                        info="Excursion percent the latest vPoint must reach in the entry direction (maxDownPct for SHORT, maxUpPct for LONG) before it may fire. Must stay below the &quot;might formed&quot; guard — 0.9 × volatility threshold (4.5 at threshold 5) — or no forming entry can fire."
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 3 }}>
                    <SettingsInfoField
                        label="Adverse %"
                        type="number"
                        size="small"
                        fullWidth
                        value={tradingConfig.formingVPointEntryAdversePct ?? 2}
                        onChange={(event) =>
                            setTradingConfig((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        formingVPointEntryAdversePct:
                                            event.target.value === ""
                                                ? undefined
                                                : Math.max(
                                                    0,
                                                    Number(event.target.value),
                                                ),
                                    }
                                    : prev,
                            )
                        }
                        slotProps={{
                            htmlInput: {
                                min: 0,
                                step: "0.1",
                            },
                        }}
                        info="Excursion in the opposite direction must stay strictly below this value, otherwise the direction no longer qualifies. Set it above Favorable % to allow the ambiguity rule where the larger favorable excursion wins."
                    />
                </Grid>

                {tradingConfig.formingVPointEntryEnabled === true && (
                    <Grid size={{ xs: 12 }}>
                        <Alert severity="warning">
                            {
                                "Averaging and reserve are off for forming-vPoint " +
                                "entries on this account, even if Watch Logic is " +
                                "enabled in the account settings."
                            }
                        </Alert>
                    </Grid>
                )}

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Entry Levels
                    </Typography>
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

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Position Limits
                    </Typography>
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

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Leverage
                    </Typography>
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

                <Grid size={{ xs: 12 }}>
                    <Typography
                        color="text.secondary"
                        sx={{ pt: 1 }}
                        variant="overline"
                    >
                        Pairing
                    </Typography>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                    <SettingsInfoField
                        label="Entry Legs"
                        select
                        size="small"
                        fullWidth
                        value={tradingConfig.entryLegs ?? "BOTH"}
                        onChange={(event) =>
                            setTradingConfig((prev) => ({
                                ...prev,
                                entryLegs: event.target.value as NonNullable<
                                    RuntimeAccountTradingConfig["entryLegs"]
                                >,
                            }))
                        }
                        info="Pair strategies (`both`, `streak`): `BOTH` opens the atomic MAIN + COUNTER pair per signal; `MAIN` or `COUNTER` trades only that one-way leg per coin. Affects future entries only; open legs keep the selection captured at entry."
                    >
                        {ENTRY_LEGS_OPTIONS.map((option) => (
                            <MenuItem
                                key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </MenuItem>
                        ))}
                    </SettingsInfoField>
                </Grid>
            </Grid>
        </SettingsGroup>
    );
}
