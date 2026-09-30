"use client";

import { useMemo } from "react";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
    Box,
    Divider,
    Stack,
    Tooltip,
    Typography,
} from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { ConfigDraft } from "@/components/settings/settings-types";

import backtestRisk, {
    type BacktestAccountRiskEstimate,
} from "./risk-estimate";

const LOSS_RANGE_TOOLTIP =
    "Estimated loss if one worker hits its first configured stop-loss " +
    "boundary at each averaging stage: entry margin + reserve steps, " +
    "times leverage, capped by the earliest of the net USDT stop, hard " +
    "percent stop, post-average tier, or level-based drift stop. Uses " +
    "each account's sandbox starting balance.";

function formatUsdt(value: number) {
    return new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
        style: "currency",
    }).format(value);
}

/** Renders "$min – $max", collapsing equal bounds into a single value. */
function formatLossRange(min: number | null, max: number | null) {
    if (min === null || max === null) return "—";
    if (min === max) return formatUsdt(min);
    return `${formatUsdt(min)} – ${formatUsdt(max)}`;
}

function AccountRiskRow({ account }: { account: BacktestAccountRiskEstimate }) {
    return (
        <Box
            sx={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                py: 0.75,
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={700} variant="body2">
                    {account.accountName}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                    Coverage level {account.entryLevelMin}–
                    {account.entryLevelMin + account.averagingStages}
                </Typography>
            </Box>
            <Box sx={{ textAlign: "right" }}>
                <Typography
                    fontWeight={700}
                    sx={{ fontVariantNumeric: "tabular-nums" }}
                    variant="body2"
                >
                    Loss range{" "}
                    {formatLossRange(
                        account.lossMinUsdt,
                        account.lossMaxUsdt,
                    )}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                    {formatUsdt(account.entryMarginUsdt)} entry ·{" "}
                    {account.leverage}x lev · {account.averagingMultiplier}x
                    mul · {account.averagingStages} avg
                </Typography>
            </Box>
        </Box>
    );
}

export default function BacktestRiskAnalysis({
    settings,
}: {
    settings: ConfigDraft;
}) {
    const estimate = useMemo(() => backtestRisk.estimate(settings), [settings]);

    return (
        <HeaderMetrics
            defaultExpanded
            rememberExpand="backtest-precision:risk-analysis"
            title={
                <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                    Risk analysis
                </Typography>
            }
        >
            {(expanded) => expanded && (
                <Box sx={{ maxWidth: 720 }}>
                    <Stack
                        alignItems="center"
                        direction="row"
                        gap={0.75}
                    >
                        <Typography
                            color="text.secondary"
                            variant="body2"
                        >
                            Estimated loss / worker
                        </Typography>
                        <Tooltip arrow title={LOSS_RANGE_TOOLTIP}>
                            <InfoOutlinedIcon
                                aria-label="About the estimated loss range"
                                color="action"
                                fontSize="small"
                            />
                        </Tooltip>
                    </Stack>
                    <Typography
                        color="error.main"
                        fontWeight={700}
                        sx={{ fontVariantNumeric: "tabular-nums" }}
                        variant="h6"
                    >
                        {formatLossRange(
                            estimate.lossMinUsdt,
                            estimate.lossMaxUsdt,
                        )}
                    </Typography>
                    <Divider sx={{ my: 1.25 }} />
                    {estimate.accounts.length === 0 && (
                        <Typography color="text.secondary" variant="body2">
                            No enabled accounts to estimate.
                        </Typography>
                    )}
                    {estimate.accounts.map((account) => (
                        <AccountRiskRow
                            account={account}
                            key={account.accountSlug}
                        />
                    ))}
                </Box>
            )}
        </HeaderMetrics>
    );
}
