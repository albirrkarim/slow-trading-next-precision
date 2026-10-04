"use client";

import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";

import type { RuntimeSafeHavenLogEntry } from "@/lib/system/storage";

import { DeleteLogButton } from "./cells";
import LogsTableShell from "./LogsTableShell";
import { formatTime, formatUsdt } from "./utils";

export default function SafeHavenLogTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (id: string) => void;
  rows: RuntimeSafeHavenLogEntry[];
}) {
  const { deletingId, error, loading, onDelete, rows } = props;

  return (
    <LogsTableShell
      emptyLabel="No Safe Haven logs recorded yet."
      error={error}
      loading={loading}
      rowCount={rows.length}
    >
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell>Mode</TableCell>
          <TableCell>Source</TableCell>
          <TableCell>Before</TableCell>
          <TableCell>After</TableCell>
          <TableCell>Delta</TableCell>
          <TableCell>Reason</TableCell>
          <TableCell align="right">Action</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell sx={{ whiteSpace: "nowrap" }}>
              {formatTime(row.createdAt)}
            </TableCell>
            <TableCell>{row.mode}</TableCell>
            <TableCell>{row.source}</TableCell>
            <TableCell>{formatUsdt(row.previousUSDT)}</TableCell>
            <TableCell>{formatUsdt(row.nextUSDT)}</TableCell>
            <TableCell>{row.deltaUSDT}</TableCell>
            <TableCell>{row.reason ?? "-"}</TableCell>
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
