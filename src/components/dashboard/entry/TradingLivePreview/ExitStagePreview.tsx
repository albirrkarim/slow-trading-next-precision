"use client";

import {
  Box,
  Typography,
} from "@mui/material";

import type { TradingLivePreviewExitStage } from "@/lib/system/trading/live-preview";

import { PreviewCalculation } from "./cells";
import { formatUsdt } from "./format";

export function ExitStagePreview({
  leverage,
  stage,
  stopLossPct,
  stopLossUSDT,
  takeProfitPct,
  targetZoneStopLossPct,
}: {
  leverage: number;
  stage: TradingLivePreviewExitStage;
  stopLossPct: number | null;
  stopLossUSDT: number | null;
  takeProfitPct: number;
  targetZoneStopLossPct: number | null;
}) {
  const marginFormula = `${stage.marginPartsUsdt
    .map(formatUsdt)
    .join(" + ")} = ${formatUsdt(stage.cumulativeMarginUsdt)}`;
  const notionalFormula = `${formatUsdt(
    stage.cumulativeMarginUsdt,
  )} x ${leverage}x = ${formatUsdt(stage.estimatedNotionalUsdt)}`;
  const profitFormula = `${formatUsdt(
    stage.estimatedNotionalUsdt,
  )} x ${takeProfitPct}% = +${formatUsdt(stage.estimatedProfitUsdt)}`;
  const lossFormula =
    stage.estimatedLossUsdt === null
      ? "Stop loss disabled"
      : `${formatUsdt(stage.estimatedNotionalUsdt)} x ${stopLossPct
      }% = -${formatUsdt(stage.estimatedLossUsdt)}`;
  const usdtLossFormula =
    stopLossUSDT === null || stage.stopLossUSDTEquivalentPct === null
      ? "USDT stop loss disabled"
      : `-${formatUsdt(stopLossUSDT)} / ${formatUsdt(
        stage.estimatedNotionalUsdt,
      )} x 100 = -${stage.stopLossUSDTEquivalentPct}%`;
  const targetZoneLossFormula =
    stage.estimatedTargetZoneLossUsdt === null
      ? "Target-zone stop disabled"
      : `${formatUsdt(stage.estimatedNotionalUsdt)} x ${targetZoneStopLossPct
      }% = -${formatUsdt(stage.estimatedTargetZoneLossUsdt)}`;
  const postAverageStopLoss = stage.postAverageStopLoss;
  const postAverageStopParts = [
    postAverageStopLoss?.maxNetPnlPct &&
      postAverageStopLoss.estimatedPercentLossUsdt !== null
      ? `${postAverageStopLoss.maxNetPnlPct}% = -${formatUsdt(
        postAverageStopLoss.estimatedPercentLossUsdt,
      )}`
      : null,
    postAverageStopLoss?.maxNetPnlUsdt &&
      postAverageStopLoss.usdtEquivalentPct !== null
      ? `-${formatUsdt(
        Math.abs(postAverageStopLoss.maxNetPnlUsdt),
      )} = -${postAverageStopLoss.usdtEquivalentPct}%`
      : null,
  ].filter((part): part is string => Boolean(part));
  const postAverageStopFormula =
    postAverageStopParts.length > 0
      ? postAverageStopParts.join(" OR ")
      : "Both boundaries disabled for this tier";
  const levelBasedDriftStop = stage.levelBasedPctDriftStopLoss;
  const levelBasedDriftFormula = levelBasedDriftStop
    ? `${levelBasedDriftStop.anchorPrice.toFixed(2)} x (1 - ${levelBasedDriftStop.adverseDriftPct
    }%) = ${levelBasedDriftStop.triggerPrice.toFixed(2)} · estimated loss ${formatUsdt(
      levelBasedDriftStop.estimatedLossUsdt,
    )}`
    : "No condition for this absolute vPoint level";
  const firstStopLabel =
    stage.firstStopLoss?.type === "LEVEL_BASED_PCT_DRIFT"
      ? "Level-based vPoint drift stop reaches first"
      : stage.firstStopLoss?.type === "POST_AVERAGE"
        ? "Post-average stop reaches first"
        : stage.firstStopLoss?.type === "NET_USDT"
          ? "Net USDT stop reaches first"
          : "Hard stop reaches first";
  const firstStopFormula =
    stage.firstStopLoss?.type === "LEVEL_BASED_PCT_DRIFT"
      ? levelBasedDriftFormula
      : stage.firstStopLoss?.type === "POST_AVERAGE"
        ? postAverageStopFormula
        : stage.firstStopLoss?.type === "NET_USDT"
          ? `Position exits at -${formatUsdt(stage.firstStopLoss.estimatedLossUsdt)}`
          : lossFormula;

  return (
    <Box
      sx={{
        borderColor: "divider",
        borderLeftStyle: "solid",
        borderLeftWidth: 3,
        mb: 1.5,
        pl: 1.25,
      }}
    >
      <Typography fontWeight={700} variant="body2">
        Stage {stage.stage}
        {stage.averagingStepsUsed === 0
          ? " - Entry only"
          : ` - After averaging ${stage.averagingStepsUsed}`}
      </Typography>
      <Box
        sx={{
          columnGap: 1.5,
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            sm: "repeat(2, minmax(0, 1fr))",
          },
          mt: 0.75,
          rowGap: 0.75,
        }}
      >
        <PreviewCalculation
          detail="entry margin + averaging margins used"
          formula={marginFormula}
          label="Cumulative margin"
        />
        {levelBasedDriftStop && (
          <PreviewCalculation
            color="error.dark"
            detail="projected LONG stop from the exact stage vPoint anchor; production and backtest reverse the adverse direction for SHORT"
            formula={levelBasedDriftFormula}
            label={`Level ${levelBasedDriftStop.absoluteLevel} vPoint drift stop (${levelBasedDriftStop.adverseDriftPct}%)`}
          />
        )}
        <PreviewCalculation
          detail="cumulative margin x leverage"
          formula={notionalFormula}
          label="Estimated notional"
        />
        <PreviewCalculation
          color="success.main"
          detail="estimated notional x take-profit percent"
          formula={profitFormula}
          label={`Profit at TP (${takeProfitPct}%)`}
        />
        <PreviewCalculation
          color={
            stage.estimatedLossUsdt === null
              ? "text.secondary"
              : "error.main"
          }
          detail={
            stage.estimatedLossUsdt === null
              ? "No stop-loss estimate"
              : "estimated notional x stop-loss percent"
          }
          formula={lossFormula}
          label={
            stopLossPct === null
              ? "Loss at SL"
              : `Loss at SL (${stopLossPct}%)`
          }
        />
        <PreviewCalculation
          color={stopLossUSDT === null ? "text.secondary" : "error.dark"}
          detail={
            stopLossUSDT === null
              ? "Net USDT stop loss is disabled"
              : "configured net USDT loss / estimated notional x 100"
          }
          formula={usdtLossFormula}
          label={
            stopLossUSDT === null
              ? "Net USDT stop loss"
              : `Net USDT stop loss (${formatUsdt(stopLossUSDT)})`
          }
        />
        <PreviewCalculation
          color={
            stage.estimatedTargetZoneLossUsdt === null
              ? "text.secondary"
              : "warning.dark"
          }
          detail={
            stage.estimatedTargetZoneLossUsdt === null
              ? "Target-zone stop loss is disabled"
              : "fee-adjusted threshold after LONG reaches TOP or SHORT reaches BOTTOM"
          }
          formula={targetZoneLossFormula}
          label={
            targetZoneStopLossPct === null
              ? "Loss at target-zone SL"
              : `Loss at target-zone SL (${targetZoneStopLossPct}%)`
          }
        />
        {postAverageStopLoss && (
          <PreviewCalculation
            color={
              postAverageStopParts.length > 0
                ? "error.dark"
                : "text.secondary"
            }
            detail="after this many completed averages, runtime and backtest exit when either active fee-adjusted net PnL boundary is reached; 0 disables that boundary"
            formula={postAverageStopFormula}
            label={`Post-average stop · tier ≥${postAverageStopLoss.minAveragingCount} average${postAverageStopLoss.minAveragingCount === 1 ? "" : "s"
              } · current ${stage.averagingStepsUsed}`}
          />
        )}
      </Box>
      {stage.firstStopLoss && (
        <Box
          sx={{
            bgcolor: "action.hover",
            border: 1,
            borderColor: "error.main",
            borderRadius: 1,
            mt: 1,
            p: 1,
          }}
        >
          <Typography
            color="error.main"
            fontWeight={700}
            letterSpacing={0.6}
            variant="caption"
          >
            FIRST STOP OUTCOME
          </Typography>
          <PreviewCalculation
            color="error.dark"
            detail="the smallest unconditional loss boundary configured for this stage; a vPoint rail crossing multiple stops is back-thought to this exact boundary"
            formula={firstStopFormula}
            label={`${firstStopLabel} · estimated loss ${formatUsdt(
              stage.firstStopLoss.estimatedLossUsdt,
            )}`}
          />
        </Box>
      )}
    </Box>
  );
}
