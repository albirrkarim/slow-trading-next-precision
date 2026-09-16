"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import moment from "moment-timezone";
import { endpoints } from "@/components/endpoints";
import SidebarButton from "@/components/ui/SidebarButton";
import type {
  PrecisionBacktestResultSummary,
  PrecisionComparisonResult,
  PrecisionTestCaseSummary,
} from "@/lib/precision";

import PrecisionPairCard from "./PrecisionPairCard";

interface CaptureStatusResponse {
  status: {
    live: { startTime: number } | null;
    sandbox: { startTime: number } | null;
  };
  testCases: PrecisionTestCaseSummary[];
}

function formatRunTime(time: number): string {
  return moment(time).tz("Asia/Jakarta").format("DD MMM YYYY HH:mm");
}

/** Production-versus-backtest result comparison page. */
export default function PrecisionCheckerPage() {
  const [testCases, setTestCases] = useState<PrecisionTestCaseSummary[]>([]);
  const [backtests, setBacktests] = useState<PrecisionBacktestResultSummary[]>(
    [],
  );
  const [selectedTestCase, setSelectedTestCase] = useState("");
  const [selectedBacktest, setSelectedBacktest] = useState("");
  const [comparison, setComparison] = useState<PrecisionComparisonResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [captureResponse, backtestResponse] = await Promise.all([
        axios.get<CaptureStatusResponse>(endpoints.precision.capture),
        axios.get<PrecisionBacktestResultSummary[]>(
          endpoints.precision.compare,
        ),
      ]);
      setTestCases(captureResponse.data.testCases);
      setBacktests(backtestResponse.data);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load precision runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const selectedTestSummary = useMemo(
    () => testCases.find((testCase) => testCase.fileName === selectedTestCase),
    [selectedTestCase, testCases],
  );
  const selectedBacktestSummary = useMemo(
    () => backtests.find((backtest) => backtest.fileName === selectedBacktest),
    [backtests, selectedBacktest],
  );

  const runComparison = useCallback(async () => {
    if (!selectedTestCase || !selectedBacktest) return;
    setComparing(true);
    setError("");
    setComparison(null);
    try {
      const response = await axios.post<PrecisionComparisonResult>(
        endpoints.precision.compare,
        { testCase: selectedTestCase, backtest: selectedBacktest },
      );
      setComparison(response.data);
    } catch (compareError: any) {
      setError(
        compareError?.response?.data?.error ??
          compareError?.message ??
          "Failed to compare precision runs",
      );
    } finally {
      setComparing(false);
    }
  }, [selectedBacktest, selectedTestCase]);

  return (
    <Stack spacing={3} sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <SidebarButton />
        <Stack>
          <Typography variant="h5">Precision Checker</Typography>
          <Typography variant="body2" color="text.secondary">
            Compare final production and backtest positions for equivalent
            runs.
          </Typography>
        </Stack>
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
              label="Backtest result"
              value={selectedBacktest}
              onChange={(event) => setSelectedBacktest(event.target.value)}
              disabled={loading || backtests.length === 0}
              fullWidth
            >
              {backtests.map((backtest) => (
                <MenuItem
                  key={backtest.fileName}
                  value={backtest.fileName}
                >
                  {formatRunTime(backtest.startTime)} |{" "}
                  {backtest.positionCount} positions
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={() => void runComparison()}
              disabled={
                comparing || loading || !selectedTestCase || !selectedBacktest
              }
              sx={{ minWidth: 140, height: 56 }}
            >
              {comparing ? "Comparing..." : "Compare"}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {comparison && !comparison.valid && (
        <Alert severity="warning">
          Runs are not comparable: {comparison.mismatches.join(", ")}
        </Alert>
      )}

      {comparison?.valid && (
        <Card>
          <CardContent>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={2}
            >
              <Stack>
                <Typography variant="h4">
                  {comparison.overallPrecisionPct === null
                    ? "Unavailable"
                    : `${comparison.overallPrecisionPct.toFixed(2)}%`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {comparison.totalEqualLeaves}/{comparison.totalLeaves} equal
                  fields across {comparison.pairCount} pairs
                </Typography>
              </Stack>
              {selectedTestSummary && selectedBacktestSummary && (
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    Period {formatRunTime(selectedTestSummary.startTime)} to{" "}
                    {formatRunTime(selectedTestSummary.endTime)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Strategy {selectedTestSummary.strategy} |{" "}
                    {comparison.totalLeaves} compared leaves
                  </Typography>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {comparison?.valid && (
        <Stack spacing={1}>
          {comparison.pairs.map((pair) => (
            <PrecisionPairCard key={pair.key} pair={pair} />
          ))}
          {comparison.pairs.length === 0 && (
            <Alert severity="info">
              No candidate pairs were found; precision is unavailable.
            </Alert>
          )}
        </Stack>
      )}

      {comparison?.valid &&
        (comparison.ambiguousKeys.length > 0 ||
          comparison.productionOnly.length > 0 ||
          comparison.backtestOnly.length > 0) && (
          <Box sx={{ display: "grid", gap: 2, md: 3 }}>
            {comparison.ambiguousKeys.length > 0 && (
              <Alert severity="warning">
                Ambiguous keys excluded from scoring:{" "}
                {comparison.ambiguousKeys
                  .map(
                    (item) =>
                      `${item.key} (production ${item.productionCount}, backtest ${item.backtestCount})`,
                  )
                  .join("; ")}
              </Alert>
            )}
            {comparison.productionOnly.length > 0 && (
              <Alert severity="info">
                Production-only positions:{" "}
                {comparison.productionOnly
                  .map((position) => position.key)
                  .join("; ")}
              </Alert>
            )}
            {comparison.backtestOnly.length > 0 && (
              <Alert severity="info">
                Backtest-only positions:{" "}
                {comparison.backtestOnly
                  .map((position) => position.key)
                  .join("; ")}
              </Alert>
            )}
          </Box>
        )}
    </Stack>
  );
}
