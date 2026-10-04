"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import {
  Box,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";

import type { RuntimeConfigLogEntry } from "@/lib/system/storage";

import { ConfigChangeValue, ConfigPath, DeleteLogButton } from "./cells";
import LogsTableShell from "./LogsTableShell";
import { formatTime } from "./utils";

export default function ConfigLogTable(props: {
  deletingId: string | null;
  error: string | null;
  loading: boolean;
  onDelete: (id: string) => void;
  rows: RuntimeConfigLogEntry[];
}) {
  const { deletingId, error, loading, onDelete, rows } = props;

  return (
    <LogsTableShell
      emptyLabel="No Config Change logs recorded yet."
      error={error}
      loading={loading}
      rowCount={rows.length}
    >
      <TableHead>
        <TableRow>
          <TableCell>Time</TableCell>
          <TableCell>Changes</TableCell>
          <TableCell>Source</TableCell>
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
              <Stack spacing={0.5}>
                {(row.changes ?? []).map((change, index) => (
                  <Stack
                    alignItems="center"
                    direction="row"
                    key={index}
                    spacing={0.75}
                  >
                    <Box
                      component="span"
                      sx={{ fontFamily: "monospace", fontSize: 12 }}
                    >
                      <ConfigPath path={change.path} />
                    </Box>
                    <ConfigChangeValue
                      side="previous"
                      value={change.previous}
                    />
                    <ArrowForwardIcon
                      color="action"
                      sx={{ fontSize: 14 }}
                    />
                    <ConfigChangeValue side="next" value={change.next} />
                  </Stack>
                ))}
              </Stack>
            </TableCell>
            <TableCell>{row.source}</TableCell>
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
