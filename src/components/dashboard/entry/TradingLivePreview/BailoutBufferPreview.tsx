"use client";

import {
  Box,
  Stack,
  Typography,
} from "@mui/material";

import ReadMoreDialogButton from "@/components/settings/Components/ReadMoreDialogButton";
import type { TradingLivePreviewData } from "@/lib/system/trading/live-preview";

import { PreviewCalculation, PreviewMetric } from "./cells";
import { formatUsdt } from "./format";

export function BailoutBufferPreview({
  preview,
}: {
  preview: Pick<
    TradingLivePreviewData,
    | "availableWorkers"
    | "bailoutBufferUsdt"
    | "bailoutCandidates"
    | "projectedBailoutLevel"
    | "projectedBailoutMultiplier"
    | "projectedBailoutPartsUsdt"
    | "projectedBailoutUsdt"
    | "spendableUsdt"
    | "workerCostUsdt"
  >;
}) {
  const spendableAfterOneWorkerUsdt = Math.max(
    0,
    preview.spendableUsdt - preview.workerCostUsdt,
  );
  const firstWorkerAllowed =
    preview.availableWorkers > 0 &&
    spendableAfterOneWorkerUsdt >= preview.bailoutBufferUsdt;
  const bailoutCandidateAmounts = [
    ...preview.bailoutCandidates.map((candidate) => candidate.marginUsdt),
    ...(preview.projectedBailoutUsdt > 0
      ? [preview.projectedBailoutUsdt]
      : []),
  ];
  const bailoutFormula =
    bailoutCandidateAmounts.length > 0
      ? `max(${bailoutCandidateAmounts
        .map(formatUsdt)
        .join(", ")}) = ${formatUsdt(preview.bailoutBufferUsdt)}`
      : `No UNRESERVED steps = ${formatUsdt(0)}`;
  const projectedBailoutFormula =
    preview.projectedBailoutMultiplier === null
      ? formatUsdt(preview.projectedBailoutUsdt)
      : `(${preview.projectedBailoutPartsUsdt
        .map(formatUsdt)
        .join(" + ")}) x ${preview.projectedBailoutMultiplier} = ${formatUsdt(
          preview.projectedBailoutUsdt,
        )}`;

  return (
    <Box data-testid="bailout-buffer-preview" sx={{ mb: 0.5 }}>
      <Stack alignItems="center" direction="row" gap={0.25}>
        <Typography color="text.secondary" variant="body2">
          Bailout buffer
        </Typography>
        <ReadMoreDialogButton
          dialogTitle="Bailout Buffer Mechanism"
          tooltip="Read more about the bailout buffer"
        >
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography variant="body2">
              The bailout buffer is shared account spendable balance.
              It is not assigned to, or locked for, one specific open
              position.
            </Typography>

            <Box>
              <Typography fontWeight={700} gutterBottom variant="body2">
                How the buffer is selected
              </Typography>
              <Typography color="text.secondary" variant="body2">
                SLOW finds the largest UNRESERVED averaging step from
                every open position and the projected new worker. It
                preserves only the largest candidate, not the sum of
                every candidate.
              </Typography>
            </Box>

            <Box>
              <Typography fontWeight={700} gutterBottom variant="body2">
                How it blocks entries
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Before entry, SLOW subtracts the entry margin and its
                reserved averaging steps from spendable balance. The
                entry is allowed only when the amount left is at least
                the shared bailout buffer.
              </Typography>
            </Box>

            <Box>
              <Typography fontWeight={700} gutterBottom variant="body2">
                Current preview
              </Typography>
              <Typography
                sx={{ fontVariantNumeric: "tabular-nums" }}
                variant="body2"
              >
                {formatUsdt(preview.spendableUsdt)} -{" "}
                {formatUsdt(preview.workerCostUsdt)} ={" "}
                {formatUsdt(spendableAfterOneWorkerUsdt)}
              </Typography>
              <Typography
                color={
                  firstWorkerAllowed ? "success.main" : "error.main"
                }
                fontWeight={700}
                sx={{ fontVariantNumeric: "tabular-nums" }}
                variant="body2"
              >
                {formatUsdt(spendableAfterOneWorkerUsdt)}{" "}
                {firstWorkerAllowed ? ">=" : "<"}{" "}
                {formatUsdt(preview.bailoutBufferUsdt)}: entry{" "}
                {firstWorkerAllowed ? "allowed" : "blocked"}
              </Typography>
            </Box>

            <Box>
              <Typography fontWeight={700} gutterBottom variant="body2">
                When it is used
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Any eligible open position can spend this balance when
                its UNRESERVED averaging step triggers. Afterward, SLOW
                recalculates the shared buffer from the updated balance
                and watch states.
              </Typography>
            </Box>
          </Box>
        </ReadMoreDialogButton>
      </Stack>

      <Box
        data-testid="bailout-buffer-candidates"
        sx={{
          borderColor: "divider",
          borderLeftStyle: "solid",
          borderLeftWidth: 2,
          ml: 0.5,
          mt: 0.5,
          pl: 1.25,
        }}
      >
        <Typography
          color="text.secondary"
          fontWeight={700}
          variant="caption"
        >
          Candidates
        </Typography>

        {preview.bailoutCandidates.length > 0 && (
          <Stack gap={0.25} mb={0.75} mt={0.5}>
            <Typography color="text.secondary" variant="caption">
              Open positions
            </Typography>
            {preview.bailoutCandidates.map((candidate, index) => (
              <PreviewMetric
                key={`${candidate.symbol}-${candidate.level}-${index}`}
                label={`${candidate.symbol}${candidate.level === null
                  ? ""
                  : ` level ${candidate.level}`
                  }`}
                value={formatUsdt(candidate.marginUsdt)}
                valueTooltip="UNRESERVED"
              />
            ))}
          </Stack>
        )}

        {preview.projectedBailoutUsdt > 0 && (
          <Box sx={{ mt: 0.5 }}>
            <PreviewCalculation
              detail="entry margin + all earlier averaging margins, multiplied by the reserve multiplier"
              formula={projectedBailoutFormula}
              label={`Projected new worker${preview.projectedBailoutLevel === null
                ? ""
                : ` level ${preview.projectedBailoutLevel}`
                }`}
            />
          </Box>
        )}

        <Box
          sx={{
            borderColor: "divider",
            borderTopStyle: "dashed",
            borderTopWidth: 1,
            mt: 0.5,
            pt: 0.75,
          }}
        >
          <PreviewCalculation
            detail="largest UNRESERVED averaging step preserved across open positions and the projected new worker"
            formula={bailoutFormula}
            label="Preserved maximum"
          />
        </Box>
      </Box>
    </Box>
  );
}
