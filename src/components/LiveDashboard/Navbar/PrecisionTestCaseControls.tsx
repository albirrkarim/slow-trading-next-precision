"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, Chip, CircularProgress, Stack } from "@mui/material";
import axios from "axios";

import { endpoints } from "@/components/endpoints";
import type { SlowTradingMode } from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading/helper/log";

interface PrecisionTestCaseStatus {
  recording: boolean;
  mode?: "live" | "sandbox";
  startTime?: number;
  tradeHistoryLength: number;
}

interface PrecisionTestCaseControlsProps {
  activeMode: SlowTradingMode;
}

const idleStatus: PrecisionTestCaseStatus = {
  recording: false,
  tradeHistoryLength: 0,
};

export default function PrecisionTestCaseControls({
  activeMode,
}: PrecisionTestCaseControlsProps) {
  const [status, setStatus] = useState<PrecisionTestCaseStatus>(idleStatus);
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await axios.get<PrecisionTestCaseStatus>(
        endpoints.slow.prod.precisionTestCase,
      );
      setStatus(response.data);
    } catch (error) {
      tradeLog.error("[Precision Test Case] status failed", error);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, activeMode]);

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
      await refreshStatus();
    } catch (error: any) {
      tradeLog.error("[Precision Test Case] action failed", error);
      alert(
        error?.response?.data?.error ??
          `Failed to ${label} the production test case`,
      );
    } finally {
      setLoading(false);
    }
  };

  const isCurrentModeRecording = status.recording && status.mode === activeMode;

  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      {/* PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS */}
      <Chip
        size="small"
        color={isCurrentModeRecording ? "warning" : "default"}
        label={
          status.recording
            ? `Recording ${status.mode ?? activeMode} · ${status.tradeHistoryLength}`
            : "Test case idle"
        }
      />
      <Button
        size="small"
        color="inherit"
        variant="outlined"
        disabled={loading || status.recording}
        onClick={() => void updateRecording("start")}
      >
        {loading && !status.recording ? <CircularProgress size={14} /> : "Start test"}
      </Button>
      <Button
        size="small"
        color="inherit"
        variant="outlined"
        disabled={loading || !status.recording}
        onClick={() => void updateRecording("end")}
      >
        {loading && status.recording ? <CircularProgress size={14} /> : "End test"}
      </Button>
    </Stack>
  );
}
