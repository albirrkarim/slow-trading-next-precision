"use client";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import { useEffect, useState } from "react";
import {
  Box,
  Divider,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";


import ExitThresholdChart from "@/components/settings/Trading/ExitThresholdChart";
import AveragingSimulationPreview from "../AveragingSimulationPreview";
import {
  buildTradingLivePreview,
  type TradingLivePreviewConfig,
} from "@/lib/system/trading/live-preview";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";

import { BailoutBufferPreview } from "./BailoutBufferPreview";
import { PreviewCalculation, PreviewMetric } from "./cells";
import { ExitStagePreview } from "./ExitStagePreview";
import { formatUsdt, parseSpendableAssumption } from "./format";
import { SpareEntryBufferReference } from "./SpareEntryBufferReference";

export default function TradingLivePreview({
  allowSpendableAssumption = false,
  config,
  dashboardState,
  sticky = false,
}: {
  allowSpendableAssumption?: boolean;
  config: TradingLivePreviewConfig;
  dashboardState: RuntimeDashboardState;
  sticky?: boolean;
}) {
  const currentSpendableUsdt = Math.max(
    0,
    dashboardState.balances.spendableQuoteAsset,
  );
  const [spendableAssumptionInput, setSpendableAssumptionInput] = useState(
    String(currentSpendableUsdt),
  );
  useEffect(() => {
    setSpendableAssumptionInput(String(currentSpendableUsdt));
  }, [currentSpendableUsdt]);

  const preview = buildTradingLivePreview({
    config,
    dashboardState,
    spendableAssumptionUsdt: parseSpendableAssumption(
      spendableAssumptionInput,
    ),
  });
  const entryPartsUsdt = [
    preview.entryMarginUsdt,
    ...preview.reserveStepsUsdt,
  ];
  const workerBudgetFormula = `${entryPartsUsdt
    .map(formatUsdt)
    .join(" + ")} = ${formatUsdt(preview.workerCostUsdt)}`;
  const spareBufferFormula = preview.entrySpareBufferEnabled
    ? `${formatUsdt(preview.workerCostUsdt)} worker + ${formatUsdt(
      preview.entrySpareBufferUsdt,
    )} spare = ${formatUsdt(
      preview.workerCostUsdt + preview.entrySpareBufferUsdt,
    )} of ${formatUsdt(preview.spendableUsdt)}`
    : "Disabled — no additional entry-sized amount is kept";
  const balanceWorkerCapacityFormula = `floor(${formatUsdt(
    preview.entryBudgetUsdt,
  )} / ${formatUsdt(
    preview.workerCostUsdt,
  )}) = ${preview.balanceAvailableWorkers}`;
  const workerCapacityFormula =
    preview.remainingPositionSlots === null
      ? balanceWorkerCapacityFormula
      : `min(${preview.balanceAvailableWorkers}, ${preview.remainingPositionSlots} position slots) = ${preview.availableWorkers}`;

  return (
    <Paper
      data-testid="trading-live-preview"
      variant="outlined"
      sx={{
        alignSelf: "start",
        borderRadius: 1,
        p: 2,
        position: sticky ? { md: "sticky" } : undefined,
        top: sticky ? { md: 16 } : undefined,
        width: "100%",
      }}
    >
      <Stack gap={1.5}>
        <Box
          sx={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <Typography fontWeight={700} variant="subtitle1">
            Live Preview
          </Typography>
          <Tooltip
            arrow
            title={`Uses the current spendable balance and open positions with the ${allowSpendableAssumption ? "unsaved" : "saved"
              } Trading settings. Coin-specific liquidity limits and final exchange fees are applied during execution.`}
          >
            <InfoOutlinedIcon
              aria-label="About live trading preview"
              color="action"
              fontSize="small"
            />
          </Tooltip>
        </Box>

        <Box>
          <Stack alignItems="center" direction="row" gap={0.75} mb={1}>
            <LoginIcon color="primary" fontSize="small" />
            <Typography fontWeight={700} variant="body2">
              Entry
            </Typography>
          </Stack>
          <Stack gap={0.75}>
            <PreviewMetric
              label="Current spendable"
              value={formatUsdt(currentSpendableUsdt)}
            />
            <PreviewMetric
              color={
                preview.maxOpenPositions > 0 &&
                  preview.currentOpenPositions >= preview.maxOpenPositions
                  ? "error.main"
                  : undefined
              }
              label="Max open positions"
              value={
                preview.maxOpenPositions > 0
                  ? `${preview.currentOpenPositions} / ${preview.maxOpenPositions}`
                  : "Disabled"
              }
              valueTooltip={
                preview.maxOpenPositions > 0
                  ? "Current open positions / configured maximum"
                  : "0 disables the maximum-open-positions entry guard"
              }
            />
            {allowSpendableAssumption && (
              <TextField
                fullWidth
                label="Spendable assumption"
                size="small"
                type="number"
                value={spendableAssumptionInput}
                onChange={(event) =>
                  setSpendableAssumptionInput(event.target.value)
                }
                slotProps={{
                  htmlInput: {
                    inputMode: "decimal",
                    min: 0,
                    step: "0.01",
                  },
                }}
              />
            )}
            <BailoutBufferPreview preview={preview} />
            {preview.bailoutBufferUsdt > 0 && (
              <PreviewMetric
                label="Spendable after preserving bailout"
                value={formatUsdt(preview.entryBudgetUsdt)}
              />
            )}
            {preview.bailoutBufferUsdt === 0 && (
              <PreviewMetric
                label="Available for new workers"
                value={formatUsdt(preview.entryBudgetUsdt)}
              />
            )}
            <PreviewCalculation
              detail="entry + each rolling averaging reserve"
              formula={workerBudgetFormula}
              label="Budget per worker"
            />
            <PreviewCalculation
              detail={
                preview.entrySpareBufferEnabled
                  ? "The spare equals one entry margin and stays spendable after this worker's entry and reserved averaging ladder are funded. It is not locked or reserved, and it is separate from the largest-UNRESERVED bailout buffer."
                  : "The optional one-entry-margin spare is off. Entry sizing fits only the worker's entry and reserved averaging ladder; the separate largest-UNRESERVED bailout buffer still applies."
              }
              formula={spareBufferFormula}
              label="Spare entry-margin buffer"
              labelAction={<SpareEntryBufferReference preview={preview} />}
            />
            <PreviewCalculation
              detail={
                preview.remainingPositionSlots === null
                  ? "floor(available for new workers / worker budget)"
                  : "lower of balance-funded workers and remaining open-position slots"
              }
              formula={workerCapacityFormula}
              label="Available workers"
            />
          </Stack>
        </Box>

        <Divider />

        <AveragingSimulationPreview simulation={preview.averagingSimulation} />

        <Divider />

        <Box>
          <Stack alignItems="center" direction="row" gap={0.75} mb={1}>
            <LogoutIcon color="action" fontSize="small" />
            <Typography fontWeight={700} variant="body2">
              Exit per worker
            </Typography>
          </Stack>
          <Stack gap={0.75}>
            <PreviewMetric label="Preview leverage" value={`${preview.leverage}x`} />
            <ExitThresholdChart
              stopLossPct={preview.stopLossPct}
              stopLossPlusEnabled={Boolean(
                config.useStopLossPlus,
              )}
              takeProfitPct={preview.takeProfitPct}
              targetZoneStopLossPct={preview.targetZoneStopLossPct}
              triggerPct={config.stopLossPlusTrigger ?? 1}
            />
            {preview.exitStages.map((stage) => (
              <ExitStagePreview
                key={stage.stage}
                leverage={preview.leverage}
                stage={stage}
                stopLossPct={preview.stopLossPct}
                stopLossUSDT={preview.stopLossUSDT}
                takeProfitPct={preview.takeProfitPct}
                targetZoneStopLossPct={preview.targetZoneStopLossPct}
              />
            ))}
            {config.adaptiveAveraging?.enabled && (
              <Typography color="text.secondary" variant="caption">
                Adaptive averaging may increase a stage margin up to{" "}
                {config.adaptiveAveraging.maxMultiplier}x to target at least{" "}
                {config.adaptiveAveraging.minProjectedProfitPct}% projected
                profit.
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
