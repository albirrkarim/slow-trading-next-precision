"use client";

import { useEffect, useMemo, useState } from "react";

import CasinoIcon from "@mui/icons-material/Casino";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";

import {
  formatSignedUsdt,
  formatUsdt,
} from "@/components/reports/DailyPnlCalendarDialog/utils";
import type { ConfigDraft } from "@/components/settings/settings-types";
import monteCarlo from "@/lib/dev/backtestPrecision/monte-carlo";
import type { Position } from "@/lib/system/trading";

import type { LazyArtifact } from "../use-backtest-artifacts";
import {
  MonteCarloDrawdownHistogram,
  MonteCarloEquityFan,
} from "./MonteCarloCharts";

const ITERATION_OPTIONS = [1_000, 5_000, 10_000, 50_000];

/**
 * Trade-resampling (Monte Carlo) view for a finished backtest: replays
 * thousands of shuffled/block-sampled orderings of the realized closed
 * positions so the drawdown distribution shows whether the recorded path
 * was lucky or typical.
 */
export default function MonteCarloTab({
  accounts,
  positions,
}: {
  accounts?: ConfigDraft["accounts"];
  positions: LazyArtifact<Position[]>;
}) {
  const { ensure } = positions;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  const [account, setAccount] = useState("all");
  const [method, setMethod] = useState<"block" | "shuffle">("block");
  const [blockSize, setBlockSize] = useState(10);
  const [iterations, setIterations] = useState(10_000);
  const [seed, setSeed] = useState("");
  const [rolledSeed, setRolledSeed] = useState(() =>
    Math.floor(Math.random() * 4294967296),
  );

  const accountSlugs = useMemo(
    () =>
      [...new Set((positions.data ?? []).map((row) => row.account))].sort(),
    [positions.data],
  );

  const startBalanceUsdt = useMemo(
    () =>
      (accounts ?? [])
        .filter(
          (entry) =>
            entry.enabled !== false &&
            (account === "all" || entry.slug === account),
        )
        .reduce(
          (sum, entry) =>
            sum + (Number(entry.sandbox?.initialBalanceUSDT) || 0),
          0,
        ),
    [accounts, account],
  );

  const trades = useMemo(
    () =>
      monteCarlo.trades(
        positions.data ?? [],
        account === "all" ? undefined : account,
      ),
    [positions.data, account],
  );

  const result = useMemo(() => {
    if (trades.length < 5 || startBalanceUsdt <= 0) return undefined;
    const parsedSeed = Number(seed);
    return monteCarlo.simulate({
      blockSize,
      iterations,
      method,
      seed: seed.trim() !== "" && Number.isFinite(parsedSeed) ? parsedSeed : rolledSeed,
      startBalanceUsdt,
      trades,
    });
  }, [trades, startBalanceUsdt, method, blockSize, iterations, seed, rolledSeed]);

  if (positions.error) return <Alert severity="error">{positions.error}</Alert>;
  if (!positions.data) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const stats: [string, string][] = result
    ? [
        ["Paths", result.iterations.toLocaleString()],
        ["Trades / path", `${result.trades}`],
        ["Start balance", formatUsdt(startBalanceUsdt)],
        ["Median max DD", formatUsdt(result.drawdownUsdt.p50)],
        ["p95 max DD", formatUsdt(result.drawdownUsdt.p95)],
        ["Worst max DD", formatUsdt(result.drawdownUsdt.max)],
        ["Median final PnL", formatSignedUsdt(result.finalPnlUsdt.p50)],
        ["p5 final PnL", formatSignedUsdt(result.finalPnlUsdt.p5)],
        ["Risk of ruin", `${(result.ruinRate * 100).toFixed(1)}%`],
        ["Median losing streak", `${result.longestLosingStreak.p50}`],
        ["Worst losing streak", `${result.longestLosingStreak.max}`],
      ]
    : [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, m: 1 }}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Account</InputLabel>
            <Select
              label="Account"
              onChange={(e) => setAccount(e.target.value)}
              value={account}
            >
              <MenuItem value="all">All accounts</MenuItem>
              {accountSlugs.map((slug) => (
                <MenuItem key={slug} value={slug}>
                  {slug}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Method</InputLabel>
            <Select
              label="Method"
              onChange={(e) => setMethod(e.target.value as "block" | "shuffle")}
              value={method}
            >
              <MenuItem value="block">Block bootstrap</MenuItem>
              <MenuItem value="shuffle">Shuffle (iid)</MenuItem>
            </Select>
          </FormControl>
          {method === "block" && (
            <TextField
              label="Block size (trades)"
              onChange={(e) => setBlockSize(Math.max(1, Number(e.target.value) || 1))}
              size="small"
              sx={{ width: 140 }}
              type="number"
              value={blockSize}
            />
          )}
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Iterations</InputLabel>
            <Select
              label="Iterations"
              onChange={(e) => setIterations(Number(e.target.value))}
              value={iterations}
            >
              {ITERATION_OPTIONS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n.toLocaleString()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Seed (optional)"
            onChange={(e) => setSeed(e.target.value)}
            size="small"
            sx={{ width: 130 }}
            type="number"
            value={seed}
          />
          <Button
            onClick={() => setRolledSeed(Math.floor(Math.random() * 4294967296))}
            size="small"
            startIcon={<CasinoIcon />}
            variant="outlined"
          >
            Reroll
          </Button>
        </Box>
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="caption">
          Each path redraws the same {trades.length} closed trades — iid, or in
          contiguous blocks that keep regime clustering — and replays the equity
          curve. A fixed seed makes the run reproducible.
        </Typography>
      </Paper>

      {trades.length < 5 && (
        <Alert severity="info">
          Need at least 5 closed trades to resample — this selection has{" "}
          {trades.length}.
        </Alert>
      )}
      {trades.length >= 5 && startBalanceUsdt <= 0 && (
        <Alert severity="warning">
          No starting balance found for this account selection.
        </Alert>
      )}

      {result && (
        <>
          <Paper variant="outlined" sx={{ display: "flex", flexWrap: "wrap", gap: 2, p: 1.5 }}>
            {stats.map(([label, value]) => (
              <Box key={label}>
                <Typography color="text.secondary" variant="caption">
                  {label}
                </Typography>
                <Typography fontWeight={600} variant="body2">
                  {value}
                </Typography>
              </Box>
            ))}
          </Paper>
          <MonteCarloDrawdownHistogram result={result} />
          <MonteCarloEquityFan result={result} />
        </>
      )}
    </Box>
  );
}
