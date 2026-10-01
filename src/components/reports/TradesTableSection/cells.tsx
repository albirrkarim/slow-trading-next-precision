"use client";

import type { ReactElement } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import JsonTreeViewer from "@/components/ui/JsonTreeViewer";
import type { SlowTradingReportRow } from "../types";

const metricTooltipSlotProps = {
  tooltip: {
    sx: {
      maxWidth: 420,
      p: 1.1,
      fontSize: "0.8rem",
      lineHeight: 1.45,
    },
  },
};

export function MetricTooltip({
  children,
  title,
}: {
  children: ReactElement;
  title: string;
}) {
  return (
    <Tooltip
      arrow
      placement="top"
      slotProps={metricTooltipSlotProps}
      title={title}
    >
      {children}
    </Tooltip>
  );
}

export function TradeAuditMessage({ message }: { message?: string }) {
  const normalizedMessage = message?.trim();

  if (!normalizedMessage) {
    return null;
  }

  return (
    <Typography
      component="p"
      variant="caption"
      color="text.secondary"
      sx={{
        m: 0,
        mt: 0.5,
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }}
    >
      {normalizedMessage}
    </Typography>
  );
}

export function FeatureCell({ row }: { row: SlowTradingReportRow }) {
  const entryFeature = row.strategy.entry.feature;
  // const decisionMessage =
  //   typeof entryFeature?.decision?.message === "string"
  //     ? entryFeature.decision.message
  //     : typeof row.message === "string"
  //       ? row.message
  //       : null;
  const hasPayload = entryFeature != null;

  return (
    <Box>
      {hasPayload ? (
        <ButtonDialog
          size="small"
          title="Feature"
          titleLong={`Feature: ${row.symbol}`}
          maxWidth="md"
        >
          {() => (
            <Box sx={{ p: 2 }}>
              <JsonTreeViewer
                ariaLabel={`Feature payload for ${row.symbol}`}
                value={entryFeature as object}
              />
            </Box>
          )}
        </ButtonDialog>
      ) : null}
    </Box>
  );
}
