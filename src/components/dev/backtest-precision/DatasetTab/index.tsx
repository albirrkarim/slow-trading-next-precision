"use client";

import {
    Alert,
    Box,
    Button,
    CircularProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Typography,
} from "@mui/material";
import axios from "axios";
import { useEffect, useId, useState } from "react";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type {
    FeatureGateDatasetOption,
    FeatureGateInfo,
    FeatureGateReport,
} from "@/lib/dev/feature-gate";

import DatasetTable from "./DatasetTable";
import MetricsCard from "./MetricsCard";

export default function DatasetTab({ cacheKey }: { cacheKey?: string }) {
    const labelId = useId();
    const [gates, setGates] = useState<FeatureGateInfo[]>([]);
    const [datasets, setDatasets] = useState<FeatureGateDatasetOption[]>([]);
    const [slug, setSlug] = useState("");
    const [hash, setHash] = useState("");
    const [report, setReport] = useState<FeatureGateReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        axios
            .get<{ gates: FeatureGateInfo[] }>(endpoints.dev.featureGateList, {
                signal: controller.signal,
            })
            .then((resp) => {
                const list = resp.data.gates ?? [];
                setGates(list);
                setSlug(
                    (current) =>
                        current ||
                        list.find((gate) => gate.slug === "v2")?.slug ||
                        list.at(-1)?.slug ||
                        "",
                );
            })
            .catch(() => setGates([]));
        axios
            .get<{ datasets: FeatureGateDatasetOption[] }>(
                endpoints.dev.featureGateDatasets,
                { signal: controller.signal },
            )
            .then((resp) => setDatasets(resp.data.datasets ?? []))
            .catch(() => setDatasets([]));
        return () => controller.abort();
    }, []);

    // The dataset hash defaults to the run currently shown on this page.
    useEffect(() => {
        if (cacheKey) setHash(cacheKey);
    }, [cacheKey]);

    // Keep a completed response tied to the selection that produced it.
    const currentReport = report?.hash === hash && report.slug === slug ? report : null;

    const evaluate = async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await axios.post<FeatureGateReport>(
                endpoints.dev.featureGateEvaluate,
                {
                    hash: hash.trim(),
                    slug,
                },
            );
            setReport(resp.data);
        } catch (requestError) {
            setReport(null);
            setError(
                axios.isAxiosError(requestError)
                    ? ((requestError.response?.data as { error?: string } | undefined)
                            ?.error ?? requestError.message)
                    : "Evaluation failed",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{
            alignItems: "start",
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(300px, 1fr)" },
            p: 1,
        }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <FormControl fullWidth size="small">
                    <InputLabel id={`${labelId}-dataset`}>Dataset run</InputLabel>
                    <Select
                        label="Dataset run"
                        labelId={`${labelId}-dataset`}
                        onChange={(event) => setHash(event.target.value)}
                        value={hash}
                    >
                        {datasets.map((run) => (
                            <MenuItem key={run.hash} value={run.hash}>
                                {`${run.coins.join(", ") || "?"} · ${run.range ?? "custom"} · ${
                                    run.createdAt
                                        ? new Date(run.createdAt).toISOString().slice(5, 16).replace("T", " ")
                                        : "?"
                                } · ${run.hash.slice(0, 8)}`}
                            </MenuItem>
                        ))}
                        {hash !== "" && !datasets.some((run) => run.hash === hash) && (
                            <MenuItem value={hash}>{`current run · ${hash.slice(0, 8)}`}</MenuItem>
                        )}
                    </Select>
                </FormControl>
                <Typography color="text.secondary" variant="caption">
                    Dataset rows from the selected run (requires
                    &quot;also produce dataset&quot; on the backtest form).
                </Typography>
                <DatasetTable
                    key={hash}
                    cacheKey={hash || undefined}
                    option={datasets.find((run) => run.hash === hash)}
                />
            </Box>

            <Box
                aria-label="Feature gate evaluation"
                component="section"
                sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
            >
                <HeaderMetrics
                    defaultExpanded
                    headerCanBeClicked
                    rememberExpand="backtest-precision:feature-gate-evaluation"
                    title={<Typography fontWeight={700} variant="body1">Evaluation metrics</Typography>}
                >
                    {(expanded) => expanded && (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel id={`${labelId}-gate`}>Feature gate</InputLabel>
                                <Select
                                    label="Feature gate"
                                    labelId={`${labelId}-gate`}
                                    onChange={(event) => setSlug(event.target.value)}
                                    value={slug}
                                >
                                    {gates.map((gate) => (
                                        <MenuItem key={gate.slug} value={gate.slug}>{gate.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Button
                                disabled={loading || !slug || !hash.trim()}
                                onClick={() => void evaluate()}
                                size="small"
                                variant="contained"
                            >
                                {loading ? <CircularProgress size={18} /> : "Evaluate"}
                            </Button>
                            {error && <Alert severity="error">{error}</Alert>}
                            {currentReport && (
                                <MetricsCard
                                    metrics={currentReport.metrics}
                                    title={`${currentReport.slug} · ${currentReport.hash.slice(0, 8)}`}
                                />
                            )}
                            {!currentReport && !loading && (
                                <Typography color="text.secondary" variant="body2">
                                    Select a gate and click Evaluate to show acceptance rate,
                                    accepted quality, good opportunities retained, bad opportunities
                                    blocked, and the accepted score distribution for this dataset.
                                </Typography>
                            )}
                        </Box>
                    )}
                </HeaderMetrics>
            </Box>
        </Box>
    );
}
