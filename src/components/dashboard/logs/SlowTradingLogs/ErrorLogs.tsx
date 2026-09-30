"use client";

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import DoNotDisturbAltIcon from "@mui/icons-material/DoNotDisturbAlt";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  alpha,
  Box,
  Button,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useSnackbar } from "notistack";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type {
  RuntimeErrorLogEntry,
  RuntimeErrorStatus,
} from "@/lib/system/storage";

import ErrorLogTable from "./ErrorLogTable";
import { DELETE_ALL_ID } from "./utils";

const ERROR_LOG_POLL_INTERVAL_MS = 30_000;
type ErrorLogFilter = RuntimeErrorStatus | "all";

export function SlowTradingErrorLogs() {
  const { enqueueSnackbar } = useSnackbar();
  const loadedRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const [rows, setRows] = useState<RuntimeErrorLogEntry[]>([]);
  const [filter, setFilter] = useState<ErrorLogFilter>("new");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: rows.length,
      dismissed: rows.filter((row) => row.status === "dismissed").length,
      new: rows.filter((row) => row.status === "new").length,
      solved: rows.filter((row) => row.status === "solved").length,
    }),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      filter === "all" ? rows : rows.filter((row) => row.status === filter),
    [filter, rows],
  );
  const hasNewErrors = counts.new > 0;

  const loadRows = useCallback(async () => {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    const isInitialLoad = !loadedRef.current;
    if (isInitialLoad) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await axios.get<RuntimeErrorLogEntry[]>(
        endpoints.system.logs,
        { params: { kind: "errors" } },
      );
      setRows(response.data);
      setSelectedIds((current) => {
        const available = new Set(response.data.map((row) => row.id));
        return new Set([...current].filter((id) => available.has(id)));
      });
      setLoaded(true);
      loadedRef.current = true;
    } catch (requestError: any) {
      if (isInitialLoad) {
        setError(
          requestError?.response?.data?.error ??
            requestError?.message ??
            "Failed to load error logs",
        );
      }
    } finally {
      requestInFlightRef.current = false;
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRows();
    const intervalId = window.setInterval(() => {
      void loadRows();
    }, ERROR_LOG_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadRows]);

  const updateStatus = useCallback(
    async (ids: string[], status: RuntimeErrorStatus) => {
      setUpdating(true);
      setError(null);
      try {
        const response = await axios.patch<{
          updated: RuntimeErrorLogEntry[];
        }>(
          endpoints.system.logs,
          { ids, status },
          { params: { kind: "errors" } },
        );
        const updatedById = new Map(
          response.data.updated.map((entry) => [entry.id, entry]),
        );
        setRows((current) =>
          current.map((entry) => updatedById.get(entry.id) ?? entry),
        );
        setSelectedIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        enqueueSnackbar(
          `${ids.length} ${ids.length === 1 ? "error" : "errors"} marked ${status}`,
          { variant: "success" },
        );
      } catch (requestError: any) {
        setError(
          requestError?.response?.data?.error ??
            requestError?.message ??
            "Failed to update error status",
        );
      } finally {
        setUpdating(false);
      }
    },
    [enqueueSnackbar],
  );

  const deleteRow = useCallback(async (id: string) => {
    if (!confirm("Delete this error permanently?")) return;
    setDeletingId(id);
    setError(null);
    try {
      await axios.delete(endpoints.system.logs, {
        params: { id, kind: "errors" },
      });
      setRows((current) => current.filter((row) => row.id !== id));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
          requestError?.message ??
          "Failed to delete error log",
      );
    } finally {
      setDeletingId(null);
    }
  }, []);

  const clearRows = useCallback(async () => {
    if (
      rows.length === 0 ||
      !confirm("Delete all Error Logs permanently? This cannot be undone.")
    ) {
      return;
    }
    setDeletingId(DELETE_ALL_ID);
    setError(null);
    try {
      await axios.delete(endpoints.system.logs, {
        params: { all: "true", kind: "errors" },
      });
      setRows([]);
      setSelectedIds(new Set());
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
          requestError?.message ??
          "Failed to delete all error logs",
      );
    } finally {
      setDeletingId(null);
    }
  }, [rows.length]);

  const copyJson = useCallback(
    async (value: RuntimeErrorLogEntry | RuntimeErrorLogEntry[]) => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        enqueueSnackbar("Error JSON copied", { variant: "success" });
      } catch {
        enqueueSnackbar("Failed to copy error JSON", { variant: "error" });
      }
    },
    [enqueueSnackbar],
  );

  const selected = [...selectedIds];

  return (
    <Box
      data-has-records={hasNewErrors ? "true" : "false"}
      data-testid="slow-trading-log-section-errors"
      sx={(theme) => ({
        ...(hasNewErrors && {
          backgroundColor: alpha(theme.palette.error.main, 0.12),
          border: `1px solid ${theme.palette.error.main}`,
          borderLeftWidth: 5,
          borderRadius: 1,
          p: 1,
        }),
      })}
    >
      <HeaderMetrics
        defaultExpanded={false}
        rememberExpand="slow-trading-logs:errors"
        title={
          <Stack alignItems="center" direction="row" spacing={0.75}>
            {hasNewErrors && <ErrorOutlineIcon color="error" fontSize="small" />}
            <Typography
              color={hasNewErrors ? "error.main" : "text.primary"}
              sx={{ fontWeight: "bold" }}
              variant="body1"
            >
              Error Logs
            </Typography>
          </Stack>
        }
        titleRight={
          <Stack
            alignItems="center"
            direction="row"
            flexWrap="wrap"
            justifyContent="flex-end"
            spacing={1}
          >
            <Typography
              color={hasNewErrors ? "error.main" : "text.secondary"}
              sx={{ fontWeight: hasNewErrors ? 700 : 400, whiteSpace: "nowrap" }}
              variant="caption"
            >
              {loading && !loaded
                ? "Loading..."
                : `${counts.new} new / ${counts.all} total`}
            </Typography>
            <Button
              disabled={counts.new === 0}
              onClick={() => void copyJson(rows.filter((row) => row.status === "new"))}
              size="small"
              startIcon={<ContentCopyIcon fontSize="small" />}
            >
              Copy New
            </Button>
            <Button
              color="error"
              disabled={rows.length === 0 || deletingId !== null}
              onClick={() => void clearRows()}
              size="small"
              startIcon={
                deletingId === DELETE_ALL_ID ? (
                  <CircularProgress color="inherit" size={16} />
                ) : (
                  <DeleteSweepIcon fontSize="small" />
                )
              }
            >
              Delete All
            </Button>
          </Stack>
        }
      >
        {(expanded) =>
          expanded && (
            <Stack spacing={1.25} sx={{ pt: 1 }}>
              <Stack
                alignItems="center"
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                spacing={1}
              >
                <ToggleButtonGroup
                  aria-label="Error status filter"
                  exclusive
                  onChange={(_, value: ErrorLogFilter | null) => {
                    if (value) setFilter(value);
                  }}
                  size="small"
                  value={filter}
                >
                  <ToggleButton value="new">New {counts.new}</ToggleButton>
                  <ToggleButton value="solved">Solved {counts.solved}</ToggleButton>
                  <ToggleButton value="dismissed">
                    Dismissed {counts.dismissed}
                  </ToggleButton>
                  <ToggleButton value="all">All {counts.all}</ToggleButton>
                </ToggleButtonGroup>
                <Stack direction="row" spacing={1}>
                  <Button
                    disabled={selected.length === 0 || updating}
                    onClick={() => void updateStatus(selected, "dismissed")}
                    size="small"
                    startIcon={<DoNotDisturbAltIcon />}
                  >
                    Dismiss Selected
                  </Button>
                  <Button
                    color="success"
                    disabled={selected.length === 0 || updating}
                    onClick={() => void updateStatus(selected, "solved")}
                    size="small"
                    startIcon={<CheckCircleOutlineIcon />}
                  >
                    Solve Selected
                  </Button>
                </Stack>
              </Stack>
              <ErrorLogTable
                deletingId={deletingId}
                error={error}
                loading={loading}
                onCopy={(row) => void copyJson(row)}
                onDelete={(id) => void deleteRow(id)}
                onSelect={(id, checked) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
                onSelectAll={(checked) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    visibleRows.forEach((row) => {
                      if (checked) next.add(row.id);
                      else next.delete(row.id);
                    });
                    return next;
                  });
                }}
                onStatus={(ids, status) => void updateStatus(ids, status)}
                rows={visibleRows}
                selectedIds={selectedIds}
                updating={updating}
              />
            </Stack>
          )
        }
      </HeaderMetrics>
    </Box>
  );
}
