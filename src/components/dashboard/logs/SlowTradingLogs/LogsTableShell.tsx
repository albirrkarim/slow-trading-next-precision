"use client";

import {
  Box,
  CircularProgress,
  Table,
  TableContainer,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";

export default function LogsTableShell(props: {
  children: ReactNode;
  emptyLabel: string;
  error: string | null;
  loading: boolean;
  rowCount: number;
}) {
  const { children, emptyLabel, error, loading, rowCount } = props;

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Loading logs...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" variant="body2" sx={{ py: 2 }}>
        {error}
      </Typography>
    );
  }

  if (rowCount === 0) {
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ mt: 1, maxHeight: 320 }}>
      <Table stickyHeader size="small">
        {children}
      </Table>
    </TableContainer>
  );
}
