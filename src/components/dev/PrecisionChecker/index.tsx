"use client";

import { endpoints } from "@/components/endpoints";
import { TradesTableSection } from "@/components/LiveDashboard/Reporting/TradesTableSection";
import SidebarButton from "@/components/ui/SidebarButton";
import format from "@/lib/system/utils/format";
import type {
    PrecisionCheckerRunResult,
    PrecisionCheckerTestCaseSummary,
} from "@/lib/dev/precisionChecker";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
    Alert,
    Box,
    Button,
    FormControl,
    Grid,
    LinearProgress,
    MenuItem,
    Select,
    Skeleton,
    Typography,
} from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";

import VolatilityPointsPanel from "./VolatilityPointsPanel";

const TRADE_TIME_FORMAT = "DD MMM YYYY HH:mm";

function testCaseLabel(testCase: PrecisionCheckerTestCaseSummary): string {
    const start = format.timeMsToReadable(testCase.startTime, TRADE_TIME_FORMAT);
    const end = format.timeMsToReadable(testCase.endTime, TRADE_TIME_FORMAT);
    return `${testCase.mode} · ${start} → ${end} · ${testCase.tradeCount} trades`;
}

function RunResultView({ result }: { result: PrecisionCheckerRunResult }) {
    const productionHistory = result.productionHistory.map((position) => ({
        ...position,
        mode: result.testCase.mode,
    }));
    const backtestHistory = result.backtestHistory.map((position) => ({
        ...position,
        mode: "sandbox" as const,
    }));

    const panels = [
        { title: "Production History", history: productionHistory, mode: result.testCase.mode },
        { title: "Backtest History", history: backtestHistory, mode: "sandbox" as const },
    ];

    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                {result.testCase.fileName}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                {testCaseLabel(result.testCase)} · {result.exchangeType}
            </Typography>

            <Box sx={{ display: "grid", gap: 2, mt: 2 }}>
                <VolatilityPointsPanel
                    title="Production Volatility points"
                    volatilityMap={result.productionVPointsMap}
                />
                <VolatilityPointsPanel
                    title="Backtest Volatility points"
                    volatilityMap={result.backtestVPointsMap}
                />
            </Box>

            <Grid container spacing={2} sx={{ mt: 1 }}>
                {panels.map((panel) => (
                    <Grid key={panel.title} size={{ xs: 12, md: 6 }}>
                        <Typography variant="h6" sx={{ mb: 1 }}>
                            {panel.title} ({panel.history.length})
                        </Typography>
                        <Box sx={{ overflowX: "auto" }}>
                            <TradesTableSection
                                accounts={result.accounts}
                                exchangeType={result.exchangeType}
                                history={panel.history}
                                mode={panel.mode}
                                onHistoryChange={() => undefined}
                                readOnly
                            />
                        </Box>
                    </Grid>
                ))}
            </Grid>
        </Box>
    );
}

export default function PrecisionChecker() {
    const [testCases, setTestCases] = useState<PrecisionCheckerTestCaseSummary[]>([]);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [selectedFileName, setSelectedFileName] = useState("");
    const [result, setResult] = useState<PrecisionCheckerRunResult | null>(null);
    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        axios
            .get<{ testCases: PrecisionCheckerTestCaseSummary[] }>(
                endpoints.dev.precisionChecker,
            )
            .then((response) => {
                if (cancelled) return;
                const cases = response.data.testCases ?? [];
                setTestCases(cases);
                setSelectedFileName(cases[0]?.fileName ?? "");
            })
            .catch((error) => {
                if (cancelled) return;
                setListError(
                    axios.isAxiosError(error)
                        ? (error.response?.data?.error ?? error.message)
                        : "Failed to load precision test cases.",
                );
            })
            .finally(() => {
                if (!cancelled) setListLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const runBacktest = async () => {
        if (!selectedFileName) return;

        setRunning(true);
        setResult(null);
        setRunError(null);
        try {
            const response = await axios.post<PrecisionCheckerRunResult>(
                endpoints.dev.precisionChecker,
                { fileName: selectedFileName },
            );
            setResult(response.data);
        } catch (error) {
            setRunError(
                axios.isAxiosError(error)
                    ? (error.response?.data?.error ?? error.message)
                    : error instanceof Error
                        ? error.message
                        : "Backtest replay failed.",
            );
        } finally {
            setRunning(false);
        }
    };

    return (
        <Box>
            <Box
                component="header"
                sx={{
                    p: 1,
                    display: "flex",
                    gap: 1,
                    alignItems: "center",
                    flexWrap: { xs: "wrap", lg: "nowrap" },
                    backgroundColor: "primary.dark",
                    borderBottom: 1,
                    borderColor: "primary.main",
                    boxShadow: 1,
                    color: "common.white",
                }}
            >
                <Typography
                    component="div"
                    variant="h6"
                    sx={{
                        alignItems: "center",
                        display: "flex",
                        flex: "0 0 auto",
                        fontSize: "1rem",
                        fontWeight: 700,
                        minHeight: 40,
                        whiteSpace: "nowrap",
                    }}
                >
                    <SidebarButton />
                    Precision Checker
                </Typography>

                {listLoading ? (
                    <Skeleton
                        variant="rounded"
                        width={360}
                        height={40}
                        sx={{ bgcolor: "rgba(255,255,255,0.15)" }}
                    />
                ) : (
                    <FormControl
                        size="small"
                        sx={{
                            minWidth: 280,
                            maxWidth: { xs: "100%", lg: 480 },
                            flex: { xs: "1 1 100%", lg: "0 1 auto" },
                            backgroundColor: "background.paper",
                            borderRadius: 1.5,
                        }}
                    >
                        <Select
                            aria-label="Production test case"
                            displayEmpty
                            value={selectedFileName}
                            disabled={running || testCases.length === 0}
                            onChange={(event) => setSelectedFileName(event.target.value)}
                        >
                            {testCases.map((testCase) => (
                                <MenuItem
                                    key={testCase.fileName}
                                    value={testCase.fileName}
                                >
                                    {testCaseLabel(testCase)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<PlayArrowIcon />}
                    disabled={running || listLoading || !selectedFileName}
                    onClick={runBacktest}
                    sx={{ flex: "0 0 auto" }}
                >
                    Run Backtest
                </Button>
            </Box>

            {running && (
                <Box sx={{ px: 2, pt: 2 }}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        Replaying {selectedFileName} with the precision backtest…
                    </Typography>
                    <LinearProgress />
                </Box>
            )}

            {listError && (
                <Alert severity="error" sx={{ m: 2 }}>
                    Failed to load captured test cases: {listError}
                </Alert>
            )}

            {runError && (
                <Alert severity="error" sx={{ m: 2 }}>
                    Backtest replay failed: {runError}
                </Alert>
            )}

            {listLoading && (
                <Grid container spacing={2} sx={{ p: 2 }}>
                    {[0, 1].map((index) => (
                        <Grid key={index} size={{ xs: 12, md: 6 }}>
                            <Skeleton variant="text" width={220} height={32} />
                            <Skeleton variant="rounded" height={360} />
                        </Grid>
                    ))}
                </Grid>
            )}

            {!listLoading && !listError && testCases.length === 0 && (
                <Alert severity="info" sx={{ m: 2 }}>
                    No captured precision test cases yet. Start and end a
                    production test case from the live dashboard, then return
                    here to replay it.
                </Alert>
            )}

            {result && <RunResultView result={result} />}
        </Box>
    );
}
