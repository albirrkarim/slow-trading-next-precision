"use client";

import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";

import type { RuntimeWithdrawalLogEntry } from "@/lib/system/storage";

import { DeleteLogButton } from "./cells";
import LogsTableShell from "./LogsTableShell";
import { formatTime, formatUsdt } from "./utils";

export default function WithdrawalLogTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (id: string) => void;
  rows: RuntimeWithdrawalLogEntry[];
}) {
  const { deletingId, error, loading, onDelete, rows } = props;

  return (
    <LogsTableShell
      emptyLabel="No withdrawal logs recorded yet."
      error={error}
      loading={loading}
      rowCount={rows.length}
    >
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell>Trigger</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Schedule</TableCell>
          <TableCell>Amount</TableCell>
          <TableCell>Network</TableCell>
          <TableCell>Message</TableCell>
          <TableCell align="right">Action</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell sx={{ whiteSpace: "nowrap" }}>
              {formatTime(row.createdAt)}
            </TableCell>
            <TableCell>{row.trigger}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell>{row.scheduleName ?? row.scheduleId}</TableCell>
            <TableCell>{formatUsdt(row.amountUSDT)}</TableCell>
            <TableCell>{row.targetNetwork ?? "-"}</TableCell>
            <TableCell>{row.message}</TableCell>
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
