"use client";

import {
  Box,
  Typography,
} from "@mui/material";

import ReadMoreDialogButton from "@/components/settings/Components/ReadMoreDialogButton";
import type { TradingLivePreviewData } from "@/lib/system/trading/live-preview";

import { formatUsdt } from "./format";

export function SpareEntryBufferReference({
  preview,
}: {
  preview: Pick<
    TradingLivePreviewData,
    | "entryMarginUsdt"
    | "entrySpareBufferEnabled"
    | "entrySpareBufferUsdt"
    | "spendableUsdt"
    | "workerCostUsdt"
  >;
}) {
  return (
    <ReadMoreDialogButton
      dialogTitle="Spare Entry-Margin Buffer"
      tooltip="Read more about the spare entry-margin buffer"
    >
      <Box sx={{ display: "grid", gap: 2 }}>
        <Typography variant="body2">
          This optional sizing cushion keeps one additional entry-margin unit
          spendable after the new worker&apos;s entry and reserved averaging
          ladder are funded.
        </Typography>

        <Box>
          <Typography fontWeight={700} gutterBottom variant="body2">
            What it does
          </Typography>
          <Typography color="text.secondary" variant="body2">
            When enabled, SLOW includes one extra entry-sized unit while fitting
            the entry margin. The money stays in spendable balance; it is not
            locked and is not moved into the averaging reserve.
          </Typography>
        </Box>

        <Box>
          <Typography fontWeight={700} gutterBottom variant="body2">
            What it does not do
          </Typography>
          <Typography color="text.secondary" variant="body2">
            It does not replace the bailout buffer. SLOW separately preserves
            the largest actual UNRESERVED averaging step. Turning this spare off
            leaves that bailout protection active. Both protections remain in
            the same spendable balance, so they can overlap rather than creating
            two separately locked pools.
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
            Entry margin: {formatUsdt(preview.entryMarginUsdt)}
          </Typography>
          <Typography
            sx={{ fontVariantNumeric: "tabular-nums" }}
            variant="body2"
          >
            Worker entry + reserves: {formatUsdt(preview.workerCostUsdt)}
          </Typography>
          <Typography
            sx={{ fontVariantNumeric: "tabular-nums" }}
            variant="body2"
          >
            Optional spare: {formatUsdt(preview.entrySpareBufferUsdt)}
          </Typography>
          <Typography
            fontWeight={700}
            sx={{ fontVariantNumeric: "tabular-nums" }}
            variant="body2"
          >
            {formatUsdt(preview.workerCostUsdt)} +{" "}
            {formatUsdt(preview.entrySpareBufferUsdt)} ={" "}
            {formatUsdt(
              preview.workerCostUsdt + preview.entrySpareBufferUsdt,
            )}{" "}
            of {formatUsdt(preview.spendableUsdt)} current spendable
          </Typography>
        </Box>

        <Typography color="text.secondary" variant="body2">
          Current setting: {preview.entrySpareBufferEnabled ? "ON" : "OFF"}.
          Change it under Trading → Averaging → Spare Entry-Margin Buffer.
        </Typography>
      </Box>
    </ReadMoreDialogButton>
  );
}
