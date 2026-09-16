"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import moment from "moment-timezone";

import { endpoints } from "@/components/endpoints";
import type { BacktestDatasetSummary } from "@/lib/backtest/dataset";
import type { PrecisionTestCaseSummary } from "@/lib/precision";

import type { BacktestRunStatus } from "./types";

interface CaptureStatusResponse {
  testCases: PrecisionTestCaseSummary[];
}

const STATUS_POLL_INTERVAL_MS = 2000;

function formatRunTime(time: number): string {
  return moment(time).tz("Asia/Jakarta").format("DD MMM YYYY HH:mm");
}

// TC: BTEST:BACKTEST_DASHBOARD_PAGE
/** Configure, run, and inspect precision backtests. */
export default function BacktestDashboardPage() {
  const [testCases, setTestCases] = useState<PrecisionTestCaseSummary[]>([]);
  const [datasets, setDatasets] = useState<BacktestDatasetSummary[]>([]);
  const [selectedTestCase, setSelectedTestCase] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [buildSymbols, setBuildSymbols] = useState("");
  const [buildDays, setBuildDays] = useState("7");
  const [runStatus, setRunStatus] = useState<BacktestRunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [captureResponse, datasetResponse] = await Promise.all([
        axios.get<CaptureStatusResponse>(endpoints.precision.capture),
        axios.get<BacktestDatasetSummary[]>(endpoints.backtest.dataset),
      ]);
      setTestCases(captureResponse.data.testCases);
      setDatasets(datasetResponse.data);
    } catch (loadError: any) {
      setError(
        loadError?.response?.data?.error ??
          loadError?.message ??
          "Failed to load backtest inputs",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(
    () => () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    },
    [],
  );

  const selectedTestCaseSummary = useMemo(
    () => testCases.find((testCase) => testCase.fileName === selectedTestCase),
    [selectedTestCase, testCases],
  );

  const startRun = useCallback(async () => {
    if (!selectedTestCase || !selectedDataset) return;
    setError("");
    setRunStatus(null);
    try {
      const response = await axios.post<{ runId: string }>(
        endpoints.backtest.run,
        { testCase: selectedTestCase, dataset: selectedDataset },
      );
      const runId = response.data.runId;
      setRunStatus({ status: "starting", updatedAt: Date.now() });
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
      pollRef.current = setInterval(() => {
        void axios
          .get<BacktestRunStatus>(endpoints.backtest.run, {
            params: { runId },
          })
          .then((statusResponse) => {
            setRunStatus(statusResponse.data);
            if (
              statusResponse.data.status === "done" ||
              statusResponse.data.status === "error"
            ) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
              }
              void loadFiles();
            }
          })
          .catch(() => undefined);
      }, STATUS_POLL_INTERVAL_MS);
    } catch (runError: any) {
      setError(
        runError?.response?.data?.error ??
          runError?.message ??
          "Failed to start backtest",
      );
    }
  }, [loadFiles, selectedDataset, selectedTestCase]);

  const buildDataset = useCallback(async () => {
    const testCase = selectedTestCaseSummary;
    if (!testCase) return;
    setBuilding(true);
    setError("");
    try {
      const runDays = Math.min(90, Math.max(1, Number(buildDays) || 7));
      const startTime =
        Math.floor(testCase.startTime / 86_400_000) * 86_400_000 -
        (runDays - 1) * 86_400_000;
      await axios.post(endpoints.backtest.dataset, {
        symbols: buildSymbols
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean),
        startTime,
        endTime: testCase.endTime,
      });
    } catch (buildError: any) {
      setError(
        buildError?.response?.data?.error ??
          buildError?.message ??
          "Failed to start dataset download",
      );
    } finally {
      setBuilding(false);
    }
  }, [buildDays, buildSymbols, selectedTestCaseSummary]);

  const running =
    runStatus?.status === "starting" || runStatus?.status === "running";

  return (
    <Stack spacing={3} sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Stack>
        <Typography variant="h5">Backtest</Typography>
        <Typography variant="body2" color="text.secondary">
          Re-run a recorded production test case through the shared runtime on
          a kline dataset.
        </Typography>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              select
              label="Production test case"
              value={selectedTestCase}
              onChange={(event) => setSelectedTestCase(event.target.value)}
              disabled={loading || testCases.length === 0}
              fullWidth
            >
              {testCases.map((testCase) => (
                <MenuItem
                  key={testCase.fileName}
                  value={testCase.fileName}
                >
                  {testCase.mode} | {formatRunTime(testCase.startTime)} |{" "}
                  {testCase.positionCount} positions
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Dataset"
              value={selectedDataset}
              onChange={(event) => setSelectedDataset(event.target.value)}
              disabled={loading || datasets.length === 0}
              fullWidth
            >
              {datasets.map((dataset) => (
                <MenuItem
                  key={dataset.fileName}
                  value={dataset.fileName}
                >
                  {dataset.symbols.join(",")} |{" "}
                  {formatRunTime(dataset.startTime)} to{" "}
                  {formatRunTime(dataset.endTime)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={() => void startRun()}
              disabled={running || !selectedTestCase || !selectedDataset}
              sx={{ minWidth: 140, height: 56 }}
            >
              {running ? "Running..." : "Run backtest"}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack
            direction={{ xs: "column", md: "row" }}
            alignItems={{ md: "flex-end" }}
            spacing={2}
          >
            <TextField
              label="Dataset symbols (comma separated)"
              value={buildSymbols}
              onChange={(event) => setBuildSymbols(event.target.value)}
              helperText="BTC is always included"
              fullWidth
            />
            <TextField
              label="Days of history"
              value={buildDays}
              onChange={(event) => setBuildDays(event.target.value)}
              sx={{ maxWidth: 160 }}
            />
            <Button
              variant="outlined"
              onClick={() => void buildDataset()}
              disabled={building || !selectedTestCaseSummary || !buildSymbols}
              sx={{ minWidth: 180, height: 56 }}
            >
              {building ? "Starting..." : "Download dataset"}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Downloads klines covering the selected test case period plus the
            requested warmup days. Runs in the background; refresh the dataset
            list after it finishes.
          </Typography>
        </CardContent>
      </Card>

      {runStatus && (
        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  {running && <CircularProgress size={18} />}
                  <Chip
                    color={
                      runStatus.status === "done"
                        ? "success"
                        : runStatus.status === "error"
                          ? "error"
                          : "default"
                    }
                    label={runStatus.status}
                    size="small"
                  />
                  {runStatus.currentTime && (
                    <Typography variant="body2" color="text.secondary">
                      Simulated through{" "}
                      {formatRunTime(runStatus.currentTime)}
                    </Typography>
                  )}
                </Stack>
                {runStatus.fileName && (
                  <Link href="/precision-checker" rel="noreferrer" target="_blank">
                    Open Precision Checker
                  </Link>
                )}
              </Stack>
              {running &&
                (runStatus.processedMinutes ?? 0) > 0 &&
                (runStatus.totalMinutes ?? 0) > 0 && (
                <LinearProgress
                  variant="determinate"
                  value={
                    ((runStatus.processedMinutes ?? 0) /
                      (runStatus.totalMinutes ?? 1)) *
                    100
                  }
                />
              )}
              {runStatus.positionCount !== undefined && (
                <Typography variant="body2">
                  {runStatus.positionCount} final positions recorded
                </Typography>
              )}
              {runStatus.metrics && (
                <Typography variant="caption" color="text.secondary">
                  {runStatus.metrics.fills} simulated fills |{" "}
                  {Object.values(runStatus.metrics.apiCalls).reduce(
                    (sum, call) => sum + call.count,
                    0,
                  )}{" "}
                  API calls | {runStatus.metrics.errors} errors |{" "}
                  {(runStatus.metrics.wallDurationMs / 1000).toFixed(1)}s
                  wall duration
                </Typography>
              )}
              {runStatus.error && (
                <Alert severity="error">{runStatus.error}</Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {datasets.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Datasets
          </Typography>
          {datasets.map((dataset) => (
            <Stack
              key={dataset.fileName}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 0.5 }}
            >
              <Chip
                label={dataset.symbols.join(",")}
                size="small"
                variant="outlined"
              />
              <Typography variant="caption" color="text.secondary">
                {formatRunTime(dataset.startTime)} to{" "}
                {formatRunTime(dataset.endTime)} | warmup from{" "}
                {formatRunTime(dataset.warmupStartTime)} |{" "}
                {dataset.marketType}
              </Typography>
            </Stack>
          ))}
        </Box>
      )}
    </Stack>
  );
}
