"use client";

import { useCallback, useEffect, useState } from "react";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import axios from "axios";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type {
  PrecisionTestCaseFileSummary,
  PrecisionTestCaseStatus,
} from "@/lib/production/precision-test-case";
import type { SlowTradingMode } from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading/helper/log";

interface PrecisionTestCaseResponse extends PrecisionTestCaseStatus {
  files: PrecisionTestCaseFileSummary[];
}

interface PrecisionTestCaseControlsProps {
  activeMode: SlowTradingMode;
}

const idleStatus: PrecisionTestCaseStatus = {
  recording: false,
  tradeHistoryLength: 0,
};

/** Formats a capture timestamp in the viewer's local timezone. */
function formatLocalTime(value: number): string {
  return new Date(value).toLocaleString();
}

/** Formats a byte count compactly for the file row metadata. */
function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Formats a recording elapsed duration compactly, e.g. `12m 08s`. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export default function PrecisionTestCaseControls({
  activeMode,
}: PrecisionTestCaseControlsProps) {
  const [status, setStatus] = useState<PrecisionTestCaseStatus>(idleStatus);
  const [files, setFiles] = useState<PrecisionTestCaseFileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(true);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshStatus = useCallback(async () => {
    setFilesLoading(true);
    try {
      const response = await axios.get<PrecisionTestCaseResponse>(
        endpoints.slow.prod.precisionTestCase,
      );
      setStatus(response.data);
      setFiles(response.data.files ?? []);
      setError(null);
    } catch (requestError) {
      tradeLog.error("[Precision Test Case] status failed", requestError);
      setError(
        axios.isAxiosError(requestError)
          ? requestError.response?.data?.error ?? requestError.message
          : "Failed to load precision test cases.",
      );
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, activeMode]);

  const recording = status.recording === true;

  useEffect(() => {
    if (!recording) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  const updateRecording = async (action: "start" | "end") => {
    if (action === "start" && status.recording) return;
    if (action === "end" && !status.recording) return;

    const label = action === "start" ? "start" : "end";
    if (!confirm(`Are you sure you want to ${label} the production test case?`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        endpoints.slow.prod.precisionTestCase,
        { action },
      );
      if (action === "end" && response.data?.fileName) {
        alert(`Precision test case saved: ${response.data.fileName}`);
      }
      setError(null);
      await refreshStatus();
    } catch (actionError: any) {
      tradeLog.error("[Precision Test Case] action failed", actionError);
      const message =
        actionError?.response?.data?.error ??
        `Failed to ${label} the production test case`;
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const removeFile = async (fileName: string) => {
    if (
      !window.confirm(
        `Delete precision test case "${fileName}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingFile(fileName);
    try {
      await axios.delete(endpoints.slow.prod.precisionTestCase, {
        data: { fileName },
      });
      setError(null);
      await refreshStatus();
    } catch (deleteError: any) {
      tradeLog.error("[Precision Test Case] delete failed", deleteError);
      setError(
        deleteError?.response?.data?.error ??
          `Failed to delete ${fileName}.`,
      );
    } finally {
      setDeletingFile(null);
    }
  };

  const tradeCount = status.tradeHistoryLength;
  const statusLine = recording
    ? `Elapsed ${formatElapsed(now - (status.startTime ?? now))} · ${tradeCount} trade${tradeCount === 1 ? "" : "s"} · ${(status.mode ?? activeMode).toUpperCase()}`
    : "Idle";

  return (
    // PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
    <Box aria-label="Precision test cases" component="section" sx={{ mb: 2 }}>
      <HeaderMetrics
        headerCanBeClicked
        rememberExpand="precision-test-cases"
        title={
          <Typography fontWeight="bold" variant="body1">
            Precision Test Cases
          </Typography>
        }
        titleRight={
          <IconButton
            aria-label={
              recording
                ? "End precision test case"
                : "Start precision test case"
            }
            color="inherit"
            disabled={loading}
            onClick={(event) => {
              event.stopPropagation();
              void updateRecording(recording ? "end" : "start");
            }}
            size="small"
            title={
              recording
                ? "End precision test case"
                : "Start precision test case"
            }
          >
            {loading ? (
              <CircularProgress color="inherit" size={18} />
            ) : recording ? (
              <StopCircleOutlinedIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </IconButton>
        }
      >
        {(expanded) => (
          <>
            <Typography
              color={recording ? "warning.main" : "text.secondary"}
              sx={{ fontVariantNumeric: "tabular-nums", mt: 0.25 }}
              variant="caption"
            >
              {statusLine}
            </Typography>

            {expanded && (
              <Stack
                gap={1}
                sx={(theme) => ({
                  border: `1px solid ${theme.palette.divider}`,
                  borderLeftWidth: 4,
                  borderRadius: 1,
                  mt: 1,
                  p: { xs: 1.5, sm: 2 },
                })}
              >
                {error && <Alert severity="error">{error}</Alert>}

                {filesLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : files.length === 0 ? (
                  <Typography color="text.secondary" variant="body2">
                    No completed precision test cases recorded yet.
                  </Typography>
                ) : (
                  files.map((file, index) => (
                    <Box
                      key={file.fileName}
                      sx={{
                        alignItems: "center",
                        borderColor: "divider",
                        borderTop: index === 0 ? 0 : 1,
                        display: "flex",
                        gap: 1,
                        pt: index === 0 ? 0 : 1,
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          fontWeight={700}
                          sx={{ overflowWrap: "anywhere" }}
                          variant="body2"
                        >
                          {file.fileName}
                        </Typography>
                        <Typography
                          color="text.secondary"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                          variant="caption"
                        >
                          {file.mode.toUpperCase()} ·{" "}
                          {formatLocalTime(file.startTime)} →{" "}
                          {formatLocalTime(file.endTime)} ·{" "}
                          {file.tradeHistoryLength} trades ·{" "}
                          {formatSize(file.sizeBytes)}
                        </Typography>
                      </Box>
                      <IconButton
                        aria-label={`Delete precision test case ${file.fileName}`}
                        color="error"
                        disabled={deletingFile === file.fileName}
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeFile(file.fileName);
                        }}
                        size="small"
                        title="Delete test case"
                      >
                        {deletingFile === file.fileName ? (
                          <CircularProgress color="inherit" size={16} />
                        ) : (
                          <DeleteOutlineIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Box>
                  ))
                )}
              </Stack>
            )}
          </>
        )}
      </HeaderMetrics>
    </Box>
  );
}
