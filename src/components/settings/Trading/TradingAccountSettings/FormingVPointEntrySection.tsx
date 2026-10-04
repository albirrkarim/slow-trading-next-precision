"use client";

import {
    Alert,
    Grid,
    Typography
} from "@mui/material";

import SettingsCheckbox from "../../Components/SettingsCheckbox";
import SettingsInfoField from "../../Components/SettingsInfoField";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

export function FormingVPointEntrySection({
    tradingConfig,
    setTradingConfig,
}: {
    tradingConfig: RuntimeAccountTradingConfig;
    setTradingConfig: Dispatch<SetStateAction<RuntimeAccountTradingConfig>>;
}) {
    const formingMaxFavorable = Number(
        tradingConfig.formingVPointEntryMaxFavorablePct,
    );
    const formingMaxBelowMin =
        Number.isFinite(formingMaxFavorable) &&
        formingMaxFavorable > 0 &&
        formingMaxFavorable <
            Number(tradingConfig.formingVPointEntryFavorablePct ?? 3);
    return (
        <>
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
                size={{ xs: 12 }}
                sx={{ alignItems: "center", display: "flex" }}
            >
                <SettingsCheckbox
                    checked={
                        tradingConfig.formingVPointEntryEnabled === true
                    }
                    info="Replaces normal entries for this account: entry fires only when the latest vPoint's running excursions qualify a forming direction (minF ≤ ↓ ≤ maxF & ↑ < A → SHORT, minF ≤ ↑ ≤ maxF & ↓ < A → LONG; if both qualify the larger favorable excursion wins, tie → no entry). Initial entries only; averaging and reserve are disabled for these positions; the late-entry drift guard and the 0.9 × volatility threshold &quot;might formed&quot; guard are skipped for these entries; exits unchanged. Applies to live, sandbox, and backtest."
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

            <Grid size={{ xs: 12, md: 4 }}>
                <SettingsInfoField
                    label="Min Favorable %"
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
                    info="Excursion percent the latest vPoint must reach in the entry direction (maxDownPct for SHORT, maxUpPct for LONG) before it may fire."
                />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
                <SettingsInfoField
                    label="Max Favorable %"
                    type="number"
                    size="small"
                    fullWidth
                    placeholder="No cap"
                    value={
                        tradingConfig.formingVPointEntryMaxFavorablePct ??
                        ""
                    }
                    onChange={(event) =>
                        setTradingConfig((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    formingVPointEntryMaxFavorablePct:
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
                    info="Optional upper cap on the favorable excursion, inclusive. Empty means no cap. Once the excursion passes this value that vPoint can no longer trigger a forming entry — excursions only grow, so the point is skipped rather than chased."
                />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
                <SettingsInfoField
                    label="Max Adverse %"
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
                    info="Excursion in the opposite direction must stay strictly below this value, otherwise the direction no longer qualifies. Set it above Min Favorable % to allow the ambiguity rule where the larger favorable excursion wins."
                />
            </Grid>

            {formingMaxBelowMin && (
                <Grid size={{ xs: 12 }}>
                    <Alert severity="warning">
                        {
                            "Max Favorable % is below Min Favorable % — " +
                            "no forming entry can fire."
                        }
                    </Alert>
                </Grid>
            )}

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
        </>
    );
}
