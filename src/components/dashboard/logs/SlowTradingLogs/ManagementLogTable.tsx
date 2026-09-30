"use client";

import {
  Chip,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";

import type { RuntimeManagementLogEntry } from "@/lib/system/storage";

import { DeleteLogButton } from "./cells";
import LogsTableShell from "./LogsTableShell";
import { formatTime } from "./utils";

export default function ManagementLogTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (id: string) => void;
  rows: RuntimeManagementLogEntry[];
}) {
  const { deletingId, error, loading, onDelete, rows } = props;

  return (
    <LogsTableShell
      emptyLabel="No Coin Management logs recorded yet."
      error={error}
      loading={loading}
      rowCount={rows.length}
    >
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell>Action</TableCell>
          <TableCell>Symbol</TableCell>
          <TableCell>Source</TableCell>
          <TableCell>Reason</TableCell>
          <TableCell align="right">Delete</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell sx={{ whiteSpace: "nowrap" }}>
              {formatTime(row.createdAt)}
            </TableCell>
            <TableCell>
              <Chip
                color={row.action === "add" ? "success" : "error"}
                label={row.action === "add" ? "Add" : "Remove"}
                size="small"
                variant="outlined"
              />
            </TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{row.symbol}</TableCell>
            <TableCell>{row.source}</TableCell>
            <TableCell>{row.reason}</TableCell>
            <TableCell align="right">
              <DeleteLogButton
                deleting={deletingId === row.id}
                disabled={deletingId !== null}
                onDelete={() => onDelete(row.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </LogsTableShell>
  );
}
