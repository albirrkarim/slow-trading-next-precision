"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { PrecisionCaptureStatus } from "@/lib/precision";
import type { SlowTradingMode } from "@/lib/runtime/types";

interface CaptureStatusResponse {
  status: {
    live: PrecisionCaptureStatus | null;
    sandbox: PrecisionCaptureStatus | null;
  };
}

// TC: PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
/** Start and End Production Test Case controls for the active dashboard mode. */
export default function ProductionTestCase({ mode }: { mode: SlowTradingMode }) {
  const [active, setActive] = useState<PrecisionCaptureStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await axios.get<CaptureStatusResponse>(
        endpoints.precision.capture,
      );
      setActive(response.data.status[mode]);
    } catch (refreshError: any) {
      setError(
        refreshError?.response?.data?.error ??
          refreshError?.message ??
          "Failed to load production test-case status",
      );
    }
  }, [mode]);

  useEffect(() => {
    setActive(null);
    void refresh();
  }, [refresh]);

  async function runAction(action: "start" | "end") {
    setPending(true);
    setError("");
    try {
      await axios.post(endpoints.precision.capture, { action, mode });
      await refresh();
    } catch (actionError: any) {
      setError(
        actionError?.response?.data?.error ??
          actionError?.message ??
          "Failed to update production test case",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <HeaderMetrics
      defaultExpanded
      headerCanBeClicked
      rememberExpand="production-test-case"
      title={
        <Typography fontWeight="bold" variant="body1">
          Production Test Case
        </Typography>
      }
    >
      {(expanded) => expanded && (
        <Stack alignItems="center" spacing={1} sx={{ py: 1 }}>
          <Stack
            alignItems="center"
            direction={{ xs: "column", sm: "row" }}
            flexWrap="wrap"
            gap={1}
          >
            <Chip
              color={active ? "success" : "default"}
              label={
                active
                  ? `Capture active since ${new Date(
                      active.startTime,
                    ).toLocaleString()}`
                  : `No active ${mode} capture`
              }
              size="small"
            />
            {active && (
              <Chip
                label={`${active.strategy} | ${active.account}`}
                size="small"
                variant="outlined"
              />
            )}
            <Button
              disabled={pending || Boolean(active)}
              onClick={() => void runAction("start")}
              size="small"
              variant="contained"
            >
              Start Production Test Case
            </Button>
            <Button
              color="warning"
              disabled={pending || !active}
              onClick={() => void runAction("end")}
              size="small"
              variant="contained"
            >
              End Production Test Case
            </Button>
            {pending && <CircularProgress size={18} sx={{ mx: 1 }} />}
            <Link href="/precision-checker" rel="noreferrer" target="_blank">
              <Box
                alignItems="center"
                component="span"
                display="inline-flex"
                gap={0.5}
              >
                <Typography variant="body2">Open Precision Checker</Typography>
                <OpenInNewIcon fontSize="small" />
              </Box>
            </Link>
          </Stack>
          {error && (
            <Typography color="error.main" variant="body2">
              {error}
            </Typography>
          )}
        </Stack>
      )}
    </HeaderMetrics>
  );
}
