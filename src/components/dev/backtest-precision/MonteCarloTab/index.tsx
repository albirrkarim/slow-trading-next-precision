"use client";

import { useEffect, useMemo, useState } from "react";

import CasinoIcon from "@mui/icons-material/Casino";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormHelperText,
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
import HintTooltip from "@/components/ui/HintTooltip";
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

  const stats: { hint: string; label: string; value: string }[] = result
    ? [
        {
          hint: "How many alternate orderings of the same trades were simulated — each path is one replayed equity curve.",
          label: "Paths",
          value: result.iterations.toLocaleString(),
        },
        {
          hint: "Closed trades replayed inside every simulated path.",
          label: "Trades / path",
          value: `${result.trades}`,
        },
        {
          hint: "Sandbox starting balance of the selected account(s) — where every simulated equity curve begins.",
          label: "Start balance",
          value: formatUsdt(startBalanceUsdt),
        },
        {
          hint: "Drawdown = the deepest dip from an equity peak to the following trough. Median = half the simulated paths dipped less than this.",
          label: "Median max DD",
          value: formatUsdt(result.drawdownUsdt.p50),
        },
        {
          hint: "95% of simulated paths had a smaller worst dip — treat this as the plausible bad case, not the extreme.",
          label: "p95 max DD",
          value: formatUsdt(result.drawdownUsdt.p95),
        },
        {
          hint: "Deepest dip any simulated path hit — the tail risk hiding inside this exact set of trades.",
          label: "Worst max DD",
          value: formatUsdt(result.drawdownUsdt.max),
        },
        {
          hint: "Ending profit of the typical path. Same trades, different order → different ending; median is the midpoint of all endings.",
          label: "Median final PnL",
          value: formatSignedUsdt(result.finalPnlUsdt.p50),
        },
        {
          hint: "Only 5% of simulated paths ended below this — the unlucky-tail outcome of the same trades.",
          label: "p5 final PnL",
          value: formatSignedUsdt(result.finalPnlUsdt.p5),
        },
        {
          hint: "Share of paths where equity reached zero — the account would have been wiped out. Should be 0%; anything above means trade sizes are too large for this edge.",
          label: "Risk of ruin",
          value: `${(result.ruinRate * 100).toFixed(1)}%`,
        },
        {
          hint: "Longest run of consecutive losing trades in a typical path — the streak length you'd normally have to sit through.",
          label: "Median losing streak",
          value: `${result.longestLosingStreak.p50}`,
        },
        {
          hint: "Longest losing run in the unluckiest simulated path — a realistic worst case for consecutive losses.",
          label: "Worst losing streak",
          value: `${result.longestLosingStreak.max}`,
        },
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
              <MenuItem value="block">
                <HintTooltip title="Redraws the same trades in consecutive chunks of the block size — keeps real winning/losing streaks intact, so drawdowns stay realistic. Usually the more honest (worse) answer.">
                  Block bootstrap
                </HintTooltip>
              </MenuItem>
              <MenuItem value="shuffle">
                <HintTooltip title="Redraws the same trades one by one in fully random order — assumes every trade is independent, which breaks up real streaks. The optimistic estimate.">
                  Shuffle (iid)
                </HintTooltip>
              </MenuItem>
            </Select>
            <FormHelperText>
              {method === "block"
                ? "Chunks of consecutive trades stay together — realistic streaks."
                : "Every trade reshuffled independently — breaks real streaks."}
            </FormHelperText>
          </FormControl>
          {method === "block" && (
            <TextField
              label={
                <HintTooltip title="How many consecutive trades are kept together per redrawn chunk — larger blocks preserve more of the real streak clustering.">
                  Block size (trades)
                </HintTooltip>
              }
              onChange={(e) => setBlockSize(Math.max(1, Number(e.target.value) || 1))}
              size="small"
              sx={{ width: 140 }}
              type="number"
              value={blockSize}
            />
          )}
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>
              <HintTooltip title="How many alternate orderings are simulated — more gives a smoother distribution; the conclusion stops changing well before 10k.">
                Iterations
              </HintTooltip>
            </InputLabel>
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
            label={
              <HintTooltip title="A number that fixes the random draws — same seed, same result, useful for comparing settings. Empty rolls a random one; Reroll picks a new one.">
                Seed (optional)
              </HintTooltip>
            }
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
          Each path redraws the same {trades.length} closed trades in a
          different order and replays the account balance — showing whether
          this backtest&rsquo;s equity curve was lucky or typical. Hover any dashed
          label for an explanation.
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
            {stats.map((stat) => (
              <Box key={stat.label}>
                <Typography color="text.secondary" variant="caption">
                  <HintTooltip title={stat.hint}>{stat.label}</HintTooltip>
                </Typography>
                <Typography fontWeight={600} variant="body2">
                  {stat.value}
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
