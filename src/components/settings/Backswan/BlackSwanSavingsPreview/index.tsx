"use client";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { BlackSwanSavingsBacktestResult } from "@/lib/dev/black-swan";
import blackSwan from "@/lib/system/trading/black-swan";
import { pickTradingConfigFields } from "../../helpers";
import type { ConfigDraft, DashboardState } from "../../settings-types";
import BlackSwanExitReasonChart from "../BlackSwanExitReasonChart";
import BlackSwanPositionScenarios from "../BlackSwanPositionScenarios";

import { ProtectionPnlChart } from "./ProtectionPnlChart";
import {
  DEFAULT_END_T,
  DEFAULT_START_T,
  formatUsdt,
  localInput,
  REQUEST_DEBOUNCE_MS,
  SummaryMetric,
} from "./shared";

export default function BlackSwanSavingsPreview({
  configDraft,
  dashboardState,
  selectedAccountSlug,
}: {
  configDraft: ConfigDraft;
  dashboardState: DashboardState;
  selectedAccountSlug?: string;
}) {
  const symbols = configDraft.management.symbols;
  const selectedTrading = configDraft.accounts.find(
    (account) =>
      account.slug ===
      (selectedAccountSlug ?? configDraft.accounts[0]?.slug),
  )?.trading;
  const [result, setResult] = useState<BlackSwanSavingsBacktestResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [startTimeText, setStartTimeText] = useState(() =>
    localInput(DEFAULT_START_T),
  );
  const [endTimeText, setEndTimeText] = useState(() =>
    localInput(DEFAULT_END_T),
  );
  const [useCache, setUseCache] = useState(true);
  const config = blackSwan.config.normalize(configDraft.management.blackSwan);
  const startTime = new Date(startTimeText).getTime();
  const endTime = new Date(endTimeText).getTime();
  const startingBalanceUSDT = Math.max(
    0,
    Number(dashboardState.balances.startingBalanceUSDT) || 0,
  );
  const requestKey = JSON.stringify({
    config,
    endTime,
    monitoringConfig: {
      negativePnlThresholdPct:
        configDraft.runtime.speedupStageNegativePnlThresholdPct,
      positivePnlThresholdPct:
        configDraft.runtime.speedupStagePositivePnlThresholdPct,
      takeProfitOffsetPct: configDraft.runtime.speedupStageTakeProfitOffsetPct,
    },
    startTime,
    startingBalanceUSDT,
    symbols,
    tradingConfig: {
      ...configDraft.management,
      ...(selectedTrading ? pickTradingConfigFields(selectedTrading) : {}),
      ...selectedTrading,
      symbols,
    },
    useCache,
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (symbols.length === 0 || startingBalanceUSDT <= 0) {
        setResult(null);
        setLoading(false);
        setError(
          "The current trading configuration needs symbols and a positive starting balance.",
        );
        return;
      }
      if (
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        startTime >= endTime
      ) {
        setResult(null);
        setLoading(false);
        setError("Choose a valid start time before the end time.");
        return;
      }

      setLoading(true);
      setError("");
      void axios
        .post(endpoints.system.blackSwan.preview, JSON.parse(requestKey), {
          signal: controller.signal,
        })
        .then((response) => {
          if (!controller.signal.aborted) {
            setResult(response.data as BlackSwanSavingsBacktestResult);
          }
        })
        .catch((requestError) => {
          if (!controller.signal.aborted) {
            setError(
              requestError?.response?.data?.error ||
              requestError?.message ||
              "Protection replay failed.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, REQUEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    endTime,
    requestKey,
    startTime,
    startingBalanceUSDT,
    symbols.length,
  ]);

  return (
    <Paper
      component="section"
      data-testid="black-swan-savings-preview"
      variant="outlined"
      sx={{ borderRadius: 1.5, p: { xs: 1.5, md: 2 } }}
    >
      <Stack spacing={2}>
        <Stack
          alignItems={{ xs: "stretch", sm: "center" }}
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={1.5}
        >
          <Box>
            <Stack alignItems="center" direction="row" spacing={0.75}>
              <Typography fontWeight={800} variant="h6">
                Black Swan Protection Replay
              </Typography>
              <MuiTooltip
                arrow
                title="Uses the unchanged 5-minute vPoint generator to find real L1 entry candidates, then independently replays live-like entry, averaging, exits, liquidation, and the current unsaved Black Swan policy on closed 1-minute candles. It never places orders."
              >
                <InfoOutlinedIcon color="action" fontSize="small" />
              </MuiTooltip>
              {loading && <Chip label="Updating…" size="small" />}
            </Stack>
            <Typography color="text.secondary" variant="body2">
              Live-like execution replay from real L1 vPoint entry signals
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            alignItems: "center",
            display: "grid",
            gap: 1.25,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
            },
          }}
        >
          <TextField
            fullWidth
            label="Start (local time)"
            onChange={(event) => setStartTimeText(event.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            type="datetime-local"
            value={startTimeText}
          />
          <TextField
            fullWidth
            label="End (local time)"
            onChange={(event) => setEndTimeText(event.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            type="datetime-local"
            value={endTimeText}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={useCache}
                onChange={(event) => setUseCache(event.target.checked)}
                size="small"
              />
            }
            label="Use cached klines"
            sx={{ gridColumn: { sm: "1 / -1" }, m: 0 }}
          />
        </Box>

        <Alert severity="info">
          The unchanged generator builds 5-minute vPoints for 30 days before
          and after the incident. The standard backtest supplies only real L1
          entry candidates. From each L1 signal, this preview independently
          follows closed 1-minute candles. A later vPoint can average only when
          its 1% reversal has actually confirmed it, using the executable price
          at that confirmation—not the earlier pivot price. Existing exits and
          liquidation are evaluated before averaging and Black Swan CRISIS.
        </Alert>

        {error && <Alert severity="error">{error}</Alert>}
        {!result && loading && (
          <Stack
            alignItems="center"
            direction="row"
            justifyContent="center"
            spacing={1.5}
            sx={{ minHeight: 220 }}
          >
            <CircularProgress size={22} />
            <Typography color="text.secondary">
              Generating 5-minute vPoints, replaying trades, and loading the
              focused 1-minute candles…
            </Typography>
          </Stack>
        )}

        {result && (
          <>
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  md: "repeat(4, minmax(0, 1fr))",
                },
              }}
            >
              <SummaryMetric
                color={
                  result.summary.protectedPnlUsdt >= 0
                    ? "success.main"
                    : "error.main"
                }
                label="Actual portfolio PnL"
                value={formatUsdt(result.summary.protectedPnlUsdt)}
              />
              <SummaryMetric
                label="Scenario positions"
                value={String(result.summary.positionCount)}
              />
              <SummaryMetric
                label="Black Swan emergency exits"
                value={String(result.summary.emergencyClosedPositions)}
              />
              <SummaryMetric
                label="Existing-strategy / liquidation exits"
                value={String(
                  result.summary.positionCount -
                  result.summary.emergencyClosedPositions,
                )}
              />
            </Box>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              flexWrap="wrap"
              gap={1}
            >
              <Chip
                label={`${result.summary.positionCount} positions · ${formatUsdt(result.summary.totalNotionalUsdt)} notional`}
                size="small"
                variant="outlined"
              />
              <Chip
                color={
                  result.summary.emergencyClosedPositions > 0
                    ? "success"
                    : "default"
                }
                label={`${result.summary.emergencyClosedPositions} emergency closed`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`Policy: ${result.config.exitPolicy}`}
                size="small"
                variant="outlined"
              />
            </Stack>

            <Box
              sx={{
                alignItems: "stretch",
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  md: "minmax(0, 1.35fr) minmax(360px, 0.65fr)",
                },
              }}
            >
              <Paper component="section" variant="outlined" sx={{ p: 1.5 }}>
                <Typography fontWeight={800} variant="subtitle1">
                  Portfolio PnL timeline
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  Net result of the simulated positions under the current Black
                  Swan configuration.
                </Typography>
                <ProtectionPnlChart result={result} />
              </Paper>
              <BlackSwanExitReasonChart positions={result.positions} />
            </Box>

            {result.positions.length === 0 && (
              <Alert severity="warning">
                The current Trading configuration produced no eligible L1 entry
                before this incident. The preview will not invent one. Adjust
                the incident range or Trading configuration to inspect a real
                vPoint-driven sequence.
              </Alert>
            )}

            <Typography color="text.secondary" variant="caption">
              Generated {result.summary.generatedVPointCount.toLocaleString()} 5-minute
              vPoints across {result.symbols.length} symbols from{" "}
              {new Date(result.vPointGenerationStartT).toLocaleString()} to{" "}
              {new Date(result.vPointGenerationEndT).toLocaleString()}. Incident positions:{" "}
              {result.positions.map((position) => position.symbol).join(", ") ||
                "none"}
              . Each position chart shows only the current protected timeline:
              CRISIS start and the earliest actual exit from the shared strategy,
              liquidation, or Black Swan policy. Use its 1m/5m switch to change
              display aggregation; vPoint generation remains 5m. Slippage,
              exchange failure, and order-book gaps remain outside this replay.
            </Typography>

            <BlackSwanPositionScenarios result={result} />
          </>
        )}
      </Stack>
    </Paper>
  );
}
