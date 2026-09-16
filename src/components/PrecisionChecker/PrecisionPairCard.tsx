"use client";

import {
  Box,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useState } from "react";
import type { PrecisionPairResult } from "@/lib/precision";

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/** Renders one position pair with its score and field differences. */
export default function PrecisionPairCard({
  pair,
}: {
  pair: PrecisionPairResult;
}) {
  const [open, setOpen] = useState(false);
  const scoreLabel = `${pair.precisionPct.toFixed(2)}%`;
  const scoreColor =
    pair.precisionPct >= 99
      ? "success"
      : pair.precisionPct >= 90
        ? "warning"
        : "error";

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        mb: 1,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.5, cursor: "pointer" }}
        onClick={() => setOpen((current) => !current)}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2">{pair.symbol}</Typography>
          <Chip size="small" label={pair.direction} />
          <Chip size="small" label={`level pair ${pair.role}`} variant="outlined" />
          <Typography variant="caption" color="text.secondary" noWrap>
            {pair.entryVPointId}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {pair.equalLeaves}/{pair.totalLeaves} fields
          </Typography>
          <Chip size="small" color={scoreColor} label={scoreLabel} />
          <IconButton size="small" aria-label="toggle differences">
            <ExpandMoreIcon
              sx={{ transform: open ? "rotate(180deg)" : "none" }}
            />
          </IconButton>
        </Stack>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2 }}>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, pair.precisionPct)}
            sx={{ mb: 2 }}
          />
          {pair.differences.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              All comparable fields match.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Field</TableCell>
                  <TableCell>Production</TableCell>
                  <TableCell>Backtest</TableCell>
                  <TableCell>Gap</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pair.differences.map((difference) => (
                  <TableRow key={difference.path}>
                    <TableCell>{difference.path}</TableCell>
                    <TableCell>{formatValue(difference.production)}</TableCell>
                    <TableCell>{formatValue(difference.backtest)}</TableCell>
                    <TableCell>
                      {difference.absGap !== undefined
                        ? `${difference.absGap}${
                            difference.pctGap !== undefined
                              ? ` (${difference.pctGap.toFixed(2)}%)`
                              : ""
                          }`
                        : "different"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
