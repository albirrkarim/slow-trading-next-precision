"use client";

import ShowChartIcon from "@mui/icons-material/ShowChart";
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
    Typography,
} from "@mui/material";
import axios from "axios";
import type { UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useState } from "react";

import TradeChartBase from "@/components/charts/TradeChartBase";
import { endpoints } from "@/components/endpoints";
import ButtonDialog from "@/components/ui/ButtonDialog";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import { windowsMs } from "@/lib/system/constants";
import type { MarketType, VolatilityPoint } from "@/lib/system/types";
import format from "@/lib/system/utils/format";
import type { Marker } from "@/lib/system/utils/ui/chart-markers";

import { sequenceLabel } from "./DatasetRow";

/** Candle window fetched around the row's signal — ±30 days. */
const SIGNAL_CONTEXT_MS = windowsMs["1m"];
/** Visible window the chart scrolls to on load — ±2 days. */
const VISIBLE_RANGE_MS = windowsMs["2d"];
/** Orange — stands out from the green/red vPoint markers. */
const SIGNAL_MARKER_COLOR = "#ff9800";

/** One orange arrow pinned on the row's own signal vPoint. */
function signalMarker(row: FeatureGateDatasetRow): Marker[] {
    const signal = row.sequences[0];
    if (!signal || !Number.isFinite(signal.t)) return [];
    return [
        {
            color: SIGNAL_MARKER_COLOR,
            position: signal.l === "B" ? "belowBar" : "aboveBar",
            price: signal.p,
            shape: signal.l === "B" ? "arrowUp" : "arrowDown",
            text: `SIGNAL ${signal.l}[${signal.lvl}]`,
            time: Math.floor(signal.t / 1000) as UTCTimestamp,
            tooltipText: signal.id,
            tooltipTitle: `SIGNAL ${signal.l}[${signal.lvl}]`,
        },
    ];
}

/**
 * Dialog body — mounts only when the dialog opens, so the run's vPoints
 * artifact is fetched lazily per opened row instead of per table page.
 */
function DatasetChartContent({
    row,
    hash,
    exchangeType,
    marketType,
}: {
    row: FeatureGateDatasetRow;
    hash: string;
    exchangeType?: string;
    marketType?: MarketType;
}) {
    const signal = row.sequences[0];
    const [vPoints, setVPoints] = useState<VolatilityPoint[] | undefined>();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        axios
            .get<{ symbol: string; vPoints: VolatilityPoint[] }>(
                endpoints.dev.backtestPrecisionDetail,
                {
                    params: { field: "vpoints", key: hash, name: row.symbol },
                    signal: controller.signal,
                },
            )
            .then((resp) => setVPoints(resp.data.vPoints ?? []))
            .catch((requestError) => {
                if (axios.isCancel(requestError)) return;
                setError(
                    axios.isAxiosError(requestError)
                        ? ((
                                requestError.response?.data as
                                    | { error?: string }
                                    | undefined
                            )?.error ?? requestError.message)
                        : "Failed to load volatility points",
                );
            });
        return () => controller.abort();
    }, [hash, row.symbol]);

    const markers = useMemo(() => signalMarker(row), [row]);

    if (!signal || !Number.isFinite(signal.t)) {
        return (
            <Typography color="text.secondary" variant="body2">
                This dataset row has no signal point to chart.
            </Typography>
        );
    }

    // Defer the chart until the vPoints land — `customVolatilityPoints` both
    // draws the markers and suppresses the klines endpoint's own volatility
    // fetch, so it must be populated on the first request.
    if (vPoints === undefined && !error) {
        return (
            <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 1, backgroundColor: "background.default" }}>
            {error && <Alert severity="warning">{error}</Alert>}
            <TradeChartBase
                customVolatilityPoints={vPoints ?? []}
                defaultInterval="15m"
                endTimeMs={signal.t + SIGNAL_CONTEXT_MS}
                exchange={exchangeType ?? "binance"}
                header={
                    <>
                        <Typography variant="body2">
                            <strong>{row.symbol}</strong>
                        </Typography>
                        <Typography variant="body2">{signal.id}</Typography>
                        <Typography variant="body2">
                            {format.timeForLog(signal.t)}
                        </Typography>
                        <Typography variant="body2">
                            {sequenceLabel(row)}
                            {row.resolved && row.missScore !== undefined
                                ? ` · score ${row.missScore}`
                                : ""}
                        </Typography>
                    </>
                }
                initialVisibleRangeMs={{
                    start: signal.t - VISIBLE_RANGE_MS,
                    end: signal.t + VISIBLE_RANGE_MS,
                }}
                marketType={marketType ?? "FUTURES"}
                markers={markers}
                startTimeMs={signal.t - SIGNAL_CONTEXT_MS}
                symbol={row.symbol}
            />
        </Box>
    );
}

export default function DatasetChartDialog({
    row,
    hash,
    exchangeType,
    marketType,
}: {
    row: FeatureGateDatasetRow;
    hash: string;
    exchangeType?: string;
    marketType?: MarketType;
}) {
    const signal = row.sequences[0];
    const disabled = !signal || !Number.isFinite(signal.t);

    return (
        <ButtonDialog
            customButton={(handleOpen) => (
                <IconButton
                    color="primary"
                    disabled={disabled}
                    onClick={handleOpen}
                    size="small"
                    title="View vPoint chart"
                >
                    <ShowChartIcon fontSize="small" />
                </IconButton>
            )}
            maxWidth="xl"
            title="Chart"
            titleLong={`${row.symbol} — Dataset vPoint`}
        >
            {() => (
                <DatasetChartContent
                    exchangeType={exchangeType}
                    hash={hash}
                    marketType={marketType}
                    row={row}
                />
            )}
        </ButtonDialog>
    );
}
