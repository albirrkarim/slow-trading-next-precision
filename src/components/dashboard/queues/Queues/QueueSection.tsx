"use client";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";

import type { QueueRow } from "./utils";
import { formatTime, getQueueAction } from "./utils";

function QueueTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (row: QueueRow) => void;
  rows: QueueRow[];
}) {
  const { deletingId, error, loading, onDelete, rows } = props;

  if (loading) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Loading queue...</Typography>
      </Stack>
    );
  }

  if (error) {
    return (
      <Typography color="error" variant="body2" sx={{ py: 2 }}>
        {error}
      </Typography>
    );
  }

  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        No pending queue items.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ mt: 1, maxHeight: 360 }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell>Created</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Last Attempt</TableCell>
            <TableCell>Next Attempt</TableCell>
            <TableCell>Latest Message</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {formatTime(row.createdAt)}
              </TableCell>
              <TableCell sx={{ minWidth: 240 }}>{getQueueAction(row)}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {row.lastAttemptAt ? formatTime(row.lastAttemptAt) : "-"}
              </TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {formatTime(row.nextAttemptAt)}
              </TableCell>
              <TableCell sx={{ minWidth: 220 }}>{row.lastMessage}</TableCell>
              <TableCell align="right">
                <Tooltip title="Delete this pending queue item">
                  <span>
                    <IconButton
                      aria-label="Delete queue item"
                      color="error"
                      disabled={deletingId !== null}
                      onClick={() => onDelete(row)}
                      size="small"
                    >
                      {deletingId === row.id ? (
                        <CircularProgress color="inherit" size={18} />
                      ) : (
                        <DeleteOutlineIcon fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function QueueSection(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (row: QueueRow) => void;
  rememberExpand: string;
  rows: QueueRow[];
}) {
  const {
    deletingId,
    error,
    loading,
    onDelete,
    rememberExpand,
    rows,
  } = props;

  return (
    <HeaderMetrics
      defaultExpanded
      rememberExpand={rememberExpand}
      title={
        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
          Queue
        </Typography>
      }
      titleRight={
        <Typography
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
          variant="caption"
        >
          {rows.length} pending
        </Typography>
      }
    >
      {(expanded) => (
        <>
          {expanded && (
            <QueueTable
              deletingId={deletingId}
              error={error}
              loading={loading}
              onDelete={onDelete}
              rows={rows}
            />
          )}
        </>
      )}
    </HeaderMetrics>
  );
}
