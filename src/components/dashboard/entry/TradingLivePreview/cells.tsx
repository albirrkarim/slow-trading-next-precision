"use client";

import {
  Box,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

export function PreviewMetric({
  color,
  label,
  value,
  valueTooltip,
}: {
  color?: string;
  label: string;
  value: string;
  valueTooltip?: string;
}) {
  const valueElement = (
    <Typography
      color={color}
      fontWeight={700}
      sx={{
        borderBottom: valueTooltip ? "1px dotted" : undefined,
        cursor: valueTooltip ? "help" : undefined,
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
      }}
      variant="body2"
    >
      {value}
    </Typography>
  );

  return (
    <Box
      sx={{
        alignItems: "baseline",
        display: "flex",
        gap: 1,
        justifyContent: "space-between",
        minWidth: 0,
      }}
    >
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      {!valueTooltip && valueElement}
      {valueTooltip && (
        <Tooltip arrow describeChild placement="top" title={valueTooltip}>
          {valueElement}
        </Tooltip>
      )}
    </Box>
  );
}

export function PreviewCalculation({
  color,
  detail,
  formula,
  label,
  labelAction,
}: {
  color?: string;
  detail: string;
  formula: string;
  label: string;
  labelAction?: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Stack alignItems="center" direction="row" gap={0.25}>
        <Typography color="text.secondary" variant="caption">
          {label}
        </Typography>
        {labelAction}
      </Stack>
      <Tooltip
        arrow
        describeChild
        placement="top"
        title={detail}
      >
        <Typography
          color={color}
          fontWeight={700}
          sx={{
            borderBottom: "1px dotted",
            cursor: "help",
            fontVariantNumeric: "tabular-nums",
            maxWidth: "100%",
            overflowWrap: "anywhere",
            width: "fit-content",
          }}
          variant="body2"
        >
          {formula}
        </Typography>
      </Tooltip>
    </Box>
  );
}
