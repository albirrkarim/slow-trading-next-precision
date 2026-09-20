"use client";

import VPointsFrequency from "@/components/LiveDashboard/Feature/VPointsFrequency";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { BacktestPrecisionResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { VolatilityPoint } from "@/lib/dynamic";
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useMemo } from "react";

interface LatestVPointRow {
  count: number;
  point: VolatilityPoint;
  symbol: string;
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(time);
}

export default function VPointsResult({
  result,
}: {
  result: BacktestPrecisionResult;
}) {
  const rows = useMemo(
    () =>
      Object.entries(result.vPointsMap)
        .flatMap(([symbol, points]): LatestVPointRow[] => {
          const point = points.at(-1);
          return point ? [{ count: points.length, point, symbol }] : [];
        })
        .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [result.vPointsMap],
  );
  const totalPoints = Object.values(result.vPointsMap).reduce(
    (total, points) => total + points.length,
    0,
  );

  return (
    <Box sx={{ p: 2 }}>
      <Paper sx={{ mb: 2, p: 2 }} variant="outlined">
        <Typography fontWeight={700} variant="h6">
          Precision Backtest vPoints
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {totalPoints.toLocaleString()} vPoints across {rows.length} symbols
        </Typography>
      </Paper>

      <VPointsFrequency volatilityMap={result.vPointsMap} />

      <HeaderMetrics
        defaultExpanded
        headerCanBeClicked
        rememberExpand="precision-backtest-latest-vpoints"
        sx={{ mt: 2 }}
        title={
          <Typography fontWeight={700} variant="body1">
            Latest Volatility Points ({rows.length})
          </Typography>
        }
      >
        {(expanded) =>
          expanded && (
            <TableContainer component={Paper} sx={{ mt: 1 }} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Symbol</TableCell>
                    <TableCell align="right">Points</TableCell>
                    <TableCell>Label</TableCell>
                    <TableCell align="right">Level</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Move</TableCell>
                    <TableCell>Detected at</TableCell>
                    <TableCell>ID</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(({ count, point, symbol }) => (
                    <TableRow hover key={symbol}>
                      <TableCell sx={{ fontWeight: 700 }}>{symbol}</TableCell>
                      <TableCell align="right">{count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          color={point.l === "T" ? "success" : "error"}
                          label={point.l === "T" ? "TOP" : "BOTTOM"}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">{point.lvl}</TableCell>
                      <TableCell align="right">
                        {point.p.toLocaleString(undefined, {
                          maximumFractionDigits: 8,
                        })}
                      </TableCell>
                      <TableCell align="right">{point.pct.toFixed(2)}%</TableCell>
                      <TableCell>{formatTime(point.t)}</TableCell>
                      <TableCell
                        sx={{
                          fontFamily: "monospace",
                          maxWidth: 240,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={point.id}
                      >
                        {point.id}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell align="center" colSpan={8}>
                        No volatility points were detected.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )
        }
      </HeaderMetrics>
    </Box>
  );
}
