"use client";

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
    Alert,
    Box,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Typography,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { FeatureGateDatasetOption, FeatureGateDatasetRow, FeatureGateInfo } from "@/lib/dev/feature-gate";
import type { ClientEvaluationResult } from "@/lib/dev/feature-gate/client";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";

import DatasetTable, { rowKey } from "./DatasetTable";
import type { EvaluationMessage } from "./evaluation.worker";
import MetricsCard from "./MetricsCard";

export default function DatasetTab({ cacheKey }: { cacheKey?: string }) {
    const labelId = useId();
    const [gates, setGates] = useState<FeatureGateInfo[]>([]);
    const [datasets, setDatasets] = useState<FeatureGateDatasetOption[]>([]);
    const [slug, setSlug] = useState("");
    const [hash, setHash] = useState("");
    const [dataset, setDataset] = useState<{ hash: string; rows?: FeatureGateDatasetRow[]; error?: string }>();
    const [evaluation, setEvaluation] = useState<{ key: string; rows: FeatureGateDatasetRow[]; result?: ClientEvaluationResult; error?: string }>();
    const [copied, setCopied] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const refreshDatasets = useCallback(() => {
        setRefreshing(true);
        axios.get<{ datasets: FeatureGateDatasetOption[] }>(endpoints.dev.featureGateDatasets)
            .then((response) => setDatasets(response.data.datasets ?? []))
            .catch(() => setDatasets([]))
            .finally(() => setRefreshing(false));
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        axios.get<{ gates: FeatureGateInfo[] }>(endpoints.dev.featureGateList, { signal: controller.signal })
            .then((response) => {
                const list = response.data.gates ?? [];
                setGates(list);
                setSlug((current) => current || list.find((gate) => gate.slug === "v2")?.slug || list.at(-1)?.slug || "");
            })
            .catch(() => setGates([]));
        axios.get<{ datasets: FeatureGateDatasetOption[] }>(endpoints.dev.featureGateDatasets, { signal: controller.signal })
            .then((response) => setDatasets(response.data.datasets ?? []))
            .catch(() => setDatasets([]));
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!cacheKey) return undefined;
        const timer = window.setTimeout(() => setHash(cacheKey), 0);
        return () => window.clearTimeout(timer);
    }, [cacheKey]);

    // A run is downloaded once, then its rows drive browser filtering and gate inference.
    useEffect(() => {
        if (!hash) return undefined;
        const controller = new AbortController();
        axios.get<{ rows: FeatureGateDatasetRow[] }>(endpoints.dev.featureGateDownload,
            { params: { hash }, signal: controller.signal })
            .then((response) => setDataset({ hash, rows: response.data.rows }))
            .catch((error) => {
                if (axios.isCancel(error)) return;
                setDataset({ hash, error: axios.isAxiosError(error)
                    ? (error.response?.data as { error?: string } | undefined)?.error ?? error.message
                    : "Failed to load dataset" });
            });
        return () => controller.abort();
    }, [hash]);

    const rows = dataset?.hash === hash ? dataset.rows : undefined;
    const evaluationKey = `${hash}:${slug}`;
    useEffect(() => {
        if (!rows || !slug) return undefined;
        const worker = new Worker(new URL("./evaluation.worker.ts", import.meta.url));
        worker.onmessage = (event: MessageEvent<EvaluationMessage>) => {
            setEvaluation({ key: evaluationKey, rows, ...event.data });
            worker.terminate();
        };
        worker.onerror = (error) => {
            setEvaluation({ key: evaluationKey, rows, error: error.message || "Feature gate evaluation failed" });
            worker.terminate();
        };
        worker.postMessage({ rows, slug, modelUrl: endpoints.dev.featureGateModel });
        return () => worker.terminate();
    }, [rows, slug, evaluationKey]);

    const currentEvaluation = evaluation?.key === evaluationKey && evaluation.rows === rows ? evaluation : undefined;
    const decisions = useMemo(() => {
        const map = new Map<string, FeatureGateResult>();
        if (!rows || !currentEvaluation?.result) return map;
        currentEvaluation.result.decisions.forEach((decision, index) => {
            if (decision && rows[index]) map.set(rowKey(rows[index]), decision);
        });
        return map;
    }, [rows, currentEvaluation]);

    const copyHash = async () => {
        try {
            await navigator.clipboard.writeText(hash);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch { /* Clipboard may be unavailable on an insecure origin. */ }
    };

    return (
        <Box sx={{ alignItems: "start", display: "grid", gap: 2,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(300px, 1fr)" }, p: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <Box sx={{ alignItems: "center", display: "flex", gap: 0.5 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id={`${labelId}-dataset`}>Dataset run</InputLabel>
                        <Select label="Dataset run" labelId={`${labelId}-dataset`}
                            onChange={(event) => setHash(event.target.value)} value={hash}>
                            {datasets.map((run) => <MenuItem key={run.hash} value={run.hash}>
                                {`${run.coins.join(", ") || "?"} · ${run.range ?? "custom"} · ${run.createdAt
                                    ? new Date(run.createdAt).toISOString().slice(5, 16).replace("T", " ") : "?"} · ${run.hash.slice(0, 8)}`}
                            </MenuItem>)}
                            {hash !== "" && !datasets.some((run) => run.hash === hash) &&
                                <MenuItem value={hash}>{`current run · ${hash.slice(0, 8)}`}</MenuItem>}
                        </Select>
                    </FormControl>
                    <IconButton aria-label="Refresh dataset runs" disabled={refreshing} onClick={refreshDatasets}
                        size="small" title="Refresh dataset runs">
                        {refreshing ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                </Box>
                {hash && <Box sx={{ alignItems: "center", display: "flex", gap: 0.5, minWidth: 0 }}>
                    <Typography color="text.secondary" component="span" sx={{ fontFamily: "monospace",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={hash} variant="caption">{hash}</Typography>
                    <IconButton aria-label="Copy dataset hash" color={copied ? "success" : "default"}
                        onClick={() => void copyHash()} size="small" title={copied ? "Copied" : "Copy dataset hash"}>
                        {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                    </IconButton>
                </Box>}
                <Typography color="text.secondary" variant="caption">
                    Dataset rows from the selected run (requires &quot;also produce dataset&quot; on the backtest form).
                </Typography>
                {!hash && <Typography color="text.secondary" variant="body2">Run a backtest to view its dataset.</Typography>}
                {hash && !rows && (dataset?.hash !== hash || !dataset.error) &&
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={16} /><Typography variant="body2">Loading dataset…</Typography>
                    </Box>}
                {dataset?.hash === hash && dataset.error && <Alert severity="warning">{dataset.error}</Alert>}
                {rows && <DatasetTable cacheKey={hash} decisions={currentEvaluation?.result ? decisions : undefined}
                    gates={gates} key={hash} onSlugChange={setSlug}
                    option={datasets.find((run) => run.hash === hash)} rows={rows} slug={slug} />}
            </Box>
            <Box aria-label="Feature gate evaluation" component="section"
                sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <HeaderMetrics defaultExpanded headerCanBeClicked
                    rememberExpand="backtest-precision:feature-gate-evaluation"
                    title={<Typography fontWeight={700} variant="body1">Evaluation metrics</Typography>}>
                    {(expanded) => expanded && <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
                        {rows && slug && !currentEvaluation && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <CircularProgress size={16} /><Typography variant="body2">Evaluating {slug}…</Typography>
                        </Box>}
                        {currentEvaluation?.error && <Alert severity="error">{currentEvaluation.error}</Alert>}
                        {currentEvaluation?.result && <MetricsCard metrics={currentEvaluation.result.metrics}
                            title={`${slug} · ${hash.slice(0, 8)}`} />}
                        {!rows && <Typography color="text.secondary" variant="body2">
                            Select a dataset to see gate decisions and metrics.
                        </Typography>}
                    </Box>}
                </HeaderMetrics>
            </Box>
        </Box>
    );
}
