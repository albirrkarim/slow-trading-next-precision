"use client";

import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";

import { endpoints } from "@/components/endpoints";
import HeaderMetrics from "@/components/ui/HeaderMetrics";

import type { GenericLogKind, LogEntryByKind } from "./types";
import { DELETE_ALL_ID } from "./utils";

export default function LogSection<K extends GenericLogKind>(props: {
  kind: K;
  renderTable: (params: {
    deletingId: string | null;
    error: string | null;
    loading: boolean;
    onDelete: (id: string) => void;
    rows: LogEntryByKind[K][];
  }) => React.ReactNode;
  title: string;
}) {
  const { kind, renderTable, title } = props;
  const [rows, setRows] = useState<LogEntryByKind[K][]>([]);
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);

  const loadRows = useCallback(async () => {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    setRequested(true);
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<LogEntryByKind[K][]>(
        endpoints.system.logs,
        {
          params: { kind },
        },
      );
      setRows(response.data);
      setLoaded(true);
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
        requestError?.message ??
        "Failed to load logs",
      );
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }, [kind]);

  const deleteRow = useCallback(
    async (id: string) => {
      if (!confirm("Delete this log record permanently?")) {
        return;
      }

      setDeletingId(id);
      setError(null);
      try {
        await axios.delete(endpoints.system.logs, {
          params: { id, kind },
        });
        setRows((current) => current.filter((row) => row.id !== id));
      } catch (requestError: any) {
        setError(
          requestError?.response?.data?.error ??
          requestError?.message ??
          "Failed to delete log record",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [kind],
  );

  const clearRows = useCallback(async () => {
    if (
      rows.length === 0 ||
      !confirm(`Delete all ${title} permanently? This cannot be undone.`)
    ) {
      return;
    }

    setDeletingId(DELETE_ALL_ID);
    setError(null);
    try {
      await axios.delete(endpoints.system.logs, {
        params: { all: "true", kind },
      });
      setRows([]);
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
        requestError?.message ??
        "Failed to delete all log records",
      );
    } finally {
      setDeletingId(null);
    }
  }, [kind, rows.length, title]);

  return (
    <Box
      data-testid={`log-section-${kind}`}
    >
      <HeaderMetrics
        defaultExpanded={false}
        rememberExpand={`logs:${kind}`}
        title={
          <Stack alignItems="center" direction="row" spacing={0.75}>
            <Typography
              color="text.primary"
              variant="body1"
              sx={{ fontWeight: "bold" }}
            >
              {title}
            </Typography>
          </Stack>
        }
        titleRight={
          <Stack direction="row" spacing={1} alignItems="center">
            {requested && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ whiteSpace: "nowrap" }}
              >
                {loading && !loaded
                  ? "Loading..."
                  : `${rows.length} latest`}
              </Typography>
            )}
            <Button
              color="error"
              disabled={!requested || rows.length === 0 || deletingId !== null}
              onClick={() => {
                void clearRows();
              }}
              size="small"
              startIcon={
                deletingId === DELETE_ALL_ID ? (
                  <CircularProgress color="inherit" size={16} />
                ) : (
                  <DeleteSweepIcon fontSize="small" />
                )
              }
              sx={{ whiteSpace: "nowrap" }}
            >
              Delete All
            </Button>
          </Stack>
        }
      >
        {(expanded) => (
          <LogSectionContent
            error={error}
            deletingId={deletingId}
            expanded={expanded}
            loading={loading}
            onLoad={loadRows}
            onDelete={deleteRow}
            renderTable={renderTable}
            requested={requested}
            rows={rows}
          />
        )}
      </HeaderMetrics>
    </Box>
  );
}

function LogSectionContent<K extends GenericLogKind>(props: {
  deletingId: string | null;
  error: string | null;
  expanded: boolean;
  loading: boolean;
  onLoad: () => Promise<void>;
  onDelete: (id: string) => void;
  renderTable: (params: {
    deletingId: string | null;
    error: string | null;
    loading: boolean;
    onDelete: (id: string) => void;
    rows: LogEntryByKind[K][];
  }) => React.ReactNode;
  requested: boolean;
  rows: LogEntryByKind[K][];
}) {
  const {
    error,
    deletingId,
    expanded,
    loading,
    onLoad,
    onDelete,
    renderTable,
    requested,
    rows,
  } = props;

  useEffect(() => {
    if (expanded && !requested) {
      void onLoad();
    }
  }, [expanded, onLoad, requested]);

  if (!expanded) {
    return null;
  }

  return <>{renderTable({ deletingId, error, loading, onDelete, rows })}</>;
}
