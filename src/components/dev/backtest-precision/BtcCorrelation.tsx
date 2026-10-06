"use client";

import { useEffect, useMemo } from "react";

import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableRow,
    Typography,
} from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { BacktestFeatureRecord } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import { stepCorrelation, type StepSample } from "@/lib/system/utils/ui/correlation";

import type { LazyArtifact } from "./use-backtest-artifacts";

const ANCHOR_SYMBOL = "BTC";

/**
 * `priceNormalized` reading across record shapes — grouped `{current}`
 * now, a flat number in cache dirs written before the group existed.
 */
const recordValue = (
    record: BacktestFeatureRecord,
): number | undefined =>
    typeof record.priceNormalized === "number"
        ? record.priceNormalized
        : record.priceNormalized?.current;

const toSamples = (records?: BacktestFeatureRecord[]): StepSample[] =>
    (records ?? [])
        .map((record) => ({ t: record.t, v: recordValue(record) }))
        .filter(
            (sample): sample is StepSample => sample.v !== undefined,
        )
        .sort((x, y) => x.t - y.t);

/** Score color by co-movement strength; sign picks the hue. */
const scoreColor = (r?: number) => {
    if (r === undefined) return "text.secondary";
    const abs = Math.abs(r);
    if (abs >= 0.5) return r > 0 ? "success.main" : "error.main";
    if (abs >= 0.2) return "warning.main";
    return "text.secondary";
};

function BtcCorrelationBody({
    datasetEndTimeMs,
    featuresMap,
    symbolOrder,
}: {
    datasetEndTimeMs?: number;
    featuresMap?: Record<string, BacktestFeatureRecord[]>;
    symbolOrder: string[];
}) {
    const rows = useMemo(() => {
        const map = featuresMap ?? {};
        const anchor = toSamples(map[ANCHOR_SYMBOL]);
        let fallbackIdx = 0;
        return Object.keys(map)
            .filter((symbol) => symbol !== ANCHOR_SYMBOL)
            .map((symbol) => {
                // Same color derivation as the Price Normalized chart so a
                // row reads against its line above.
                const orderIdx = symbolOrder.indexOf(symbol);
                const color =
                    DEFAULT_COLORS[
                        (orderIdx >= 0 ? orderIdx : fallbackIdx) %
                            DEFAULT_COLORS.length
                    ];
                if (orderIdx < 0) fallbackIdx += 1;
                const { r, samples } = stepCorrelation(
                    toSamples(map[symbol]),
                    anchor,
                    datasetEndTimeMs,
                );
                return { color, r, samples, symbol };
            });
    }, [datasetEndTimeMs, featuresMap, symbolOrder]);

    if (rows.length === 0) {
        return (
            <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                No feature records were captured for this run.
            </Typography>
        );
    }

    if (toSamples((featuresMap ?? {})[ANCHOR_SYMBOL]).length === 0) {
        return (
            <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                No {ANCHOR_SYMBOL} feature stream was recorded — correlation
                needs the anchor series.
            </Typography>
        );
    }

    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography
                color="text.secondary"
                sx={{ pb: 1 }}
                variant="caption"
            >
                Time-weighted Pearson r of each symbol&apos;s priceNormalized
                vs {ANCHOR_SYMBOL} — +1 moves with {ANCHOR_SYMBOL}, −1 moves
                opposite, ~0 independent.
            </Typography>
            <TableContainer>
                <Table size="small" sx={{ maxWidth: 420 }}>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.symbol}>
                                <TableCell sx={{ borderBottom: 0, py: 0.25 }}>
                                    <Box
                                        sx={{
                                            alignItems: "center",
                                            display: "flex",
                                            gap: 0.75,
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                bgcolor: row.color,
                                                borderRadius: "50%",
                                                height: 8,
                                                width: 8,
                                            }}
                                        />
                                        <Typography variant="body2">
                                            {row.symbol}
                                        </Typography>
                                    </Box>
                                </TableCell>
                                <TableCell
                                    align="right"
                                    sx={{ borderBottom: 0, py: 0.25 }}
                                >
                                    <Typography
                                        color="text.secondary"
                                        variant="caption"
                                    >
                                        n={row.samples}
                                    </Typography>
                                </TableCell>
                                <TableCell
                                    align="right"
                                    sx={{ borderBottom: 0, py: 0.25, width: 70 }}
                                >
                                    <Typography
                                        color={scoreColor(row.r)}
                                        fontWeight={600}
                                        variant="body2"
                                    >
                                        {row.r === undefined
                                            ? "—"
                                            : row.r.toFixed(3)}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}

/**
 * BTC Correlation — per-symbol time-weighted correlation of the recorded
 * `priceNormalized` stream against BTC's, under the Price Normalized chart.
 * Shares the same lazily-fetched features artifact: expanding either
 * section triggers one request and both read the cached result.
 */
export default function BtcCorrelation({
    datasetEndTimeMs,
    features,
    symbolOrder,
}: {
    /** Window end — the last aligned segment runs up to this time. */
    datasetEndTimeMs?: number;
    features: LazyArtifact<Record<string, BacktestFeatureRecord[]>>;
    symbolOrder: string[];
}) {
    return (
        <HeaderMetrics
            defaultExpanded={false}
            headerCanBeClicked
            rememberExpand="precision-backtest-btc-correlation"
            sx={{ mb: 1 }}
            title={
                <Typography fontWeight={700} variant="body1">
                    BTC Correlation
                </Typography>
            }
        >
            {(expanded) =>
                expanded && (
                    <LazyBody
                        datasetEndTimeMs={datasetEndTimeMs}
                        features={features}
                        symbolOrder={symbolOrder}
                    />
                )
            }
        </HeaderMetrics>
    );
}

/** Mounts only while expanded so the artifact request fires lazily. */
function LazyBody({
    datasetEndTimeMs,
    features,
    symbolOrder,
}: {
    datasetEndTimeMs?: number;
    features: LazyArtifact<Record<string, BacktestFeatureRecord[]>>;
    symbolOrder: string[];
}) {
    const { ensure, error, data } = features;
    useEffect(() => {
        void ensure();
    }, [ensure]);

    if (error) {
        return (
            <Typography color="error" sx={{ py: 2 }} variant="body2">
                {error}
            </Typography>
        );
    }
    if (data === undefined) {
        return (
            <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                Loading feature records…
            </Typography>
        );
    }
    return (
        <BtcCorrelationBody
            datasetEndTimeMs={datasetEndTimeMs}
            featuresMap={data}
            symbolOrder={symbolOrder}
        />
    );
}
