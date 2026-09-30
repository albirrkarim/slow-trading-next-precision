"use client";

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoNotDisturbAltIcon from "@mui/icons-material/DoNotDisturbAlt";
import ReplayIcon from "@mui/icons-material/Replay";
import {
  alpha,
  Checkbox,
  Chip,
  IconButton,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";

import type {
  RuntimeErrorLogEntry,
  RuntimeErrorStatus,
} from "@/lib/system/storage";

import { DeleteLogButton } from "./cells";
import LogsTableShell from "./LogsTableShell";
import { formatTime } from "./utils";

export default function ErrorLogTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onCopy: (row: RuntimeErrorLogEntry) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onStatus: (ids: string[], status: RuntimeErrorStatus) => void;
  rows: RuntimeErrorLogEntry[];
  selectedIds: Set<string>;
  updating: boolean;
}) {
  const {
    deletingId,
    error,
    loading,
    onCopy,
    onDelete,
    onSelect,
    onSelectAll,
    onStatus,
    rows,
    selectedIds,
    updating,
  } = props;
  const selectedVisible = rows.filter((row) => selectedIds.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedVisible === rows.length;

  return (
    <LogsTableShell
      emptyLabel="No error logs match this status."
      error={error}
      loading={loading}
      rowCount={rows.length}
    >
      <TableHead>
        <TableRow>
          <TableCell padding="checkbox">
            <Checkbox
              checked={allSelected}
              disabled={rows.length === 0 || updating}
              indeterminate={selectedVisible > 0 && !allSelected}
              inputProps={{ "aria-label": "Select visible errors" }}
              onChange={(_, checked) => onSelectAll(checked)}
              size="small"
            />
          </TableCell>
          <TableCell>Time</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Source</TableCell>
          <TableCell>Message</TableCell>
          <TableCell align="right">Action</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            data-status={row.status}
            key={row.id}
            sx={(theme) => ({
              backgroundColor:
                row.status === "new"
                  ? alpha(theme.palette.error.main, 0.1)
                  : row.status === "solved"
                    ? alpha(theme.palette.success.main, 0.1)
                    : alpha(theme.palette.text.primary, 0.035),
              "& > td:first-of-type": {
                borderLeft: `4px solid ${
                  row.status === "new"
                    ? theme.palette.error.main
                    : row.status === "solved"
                      ? theme.palette.success.main
                      : theme.palette.divider
                }`,
              },
            })}
          >
            <TableCell padding="checkbox">
              <Checkbox
                checked={selectedIds.has(row.id)}
                disabled={updating}
                inputProps={{ "aria-label": `Select error ${row.id}` }}
                onChange={(_, checked) => onSelect(row.id, checked)}
                size="small"
              />
            </TableCell>
            <TableCell sx={{ whiteSpace: "nowrap" }}>
              {formatTime(row.createdAt)}
            </TableCell>
            <TableCell>
              <Chip
                color={
                  row.status === "new"
                    ? "error"
                    : row.status === "solved"
                      ? "success"
                      : "default"
                }
                label={row.status}
                size="small"
                variant={row.status === "dismissed" ? "outlined" : "filled"}
              />
            </TableCell>
            <TableCell>{row.source}</TableCell>
            <TableCell>{row.message}</TableCell>
            <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
              <Tooltip title="Copy error JSON">
                <IconButton
                  aria-label={`Copy error ${row.id} JSON`}
                  onClick={() => onCopy(row)}
                  size="small"
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {row.status !== "dismissed" && (
                <Tooltip title="Dismiss error">
                  <span>
                    <IconButton
                      aria-label={`Dismiss error ${row.id}`}
                      disabled={updating}
                      onClick={() => onStatus([row.id], "dismissed")}
                      size="small"
                    >
                      <DoNotDisturbAltIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {row.status !== "solved" && (
                <Tooltip title="Mark error solved">
                  <span>
                    <IconButton
                      aria-label={`Solve error ${row.id}`}
                      color="success"
                      disabled={updating}
                      onClick={() => onStatus([row.id], "solved")}
                      size="small"
                    >
                      <CheckCircleOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {row.status !== "new" && (
                <Tooltip title="Reopen error">
                  <span>
                    <IconButton
                      aria-label={`Reopen error ${row.id}`}
                      color="error"
                      disabled={updating}
                      onClick={() => onStatus([row.id], "new")}
                      size="small"
                    >
                      <ReplayIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <DeleteLogButton
                deleting={deletingId === row.id}
                disabled={deletingId !== null || updating}
                onDelete={() => onDelete(row.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </LogsTableShell>
  );
}
