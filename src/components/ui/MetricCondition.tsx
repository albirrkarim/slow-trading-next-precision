"use client";

import { MenuItem, TextField } from "@mui/material";

import numericFilter from "@/lib/system/utils/numeric-filter";
import type { NumericFilterOperator } from "@/lib/system/utils/numeric-filter";

export default function MetricCondition<M extends string>({
  metric, metrics, onMetricChange, onOperatorChange, onValueChange,
  operator, value, metricLabel = "Metric", operatorLabel = "Op",
}: {
  metric: M;
  metrics: Record<M, { label: string }>;
  onMetricChange: (metric: M) => void;
  onOperatorChange: (operator: NumericFilterOperator) => void;
  onValueChange: (value: string) => void;
  operator: NumericFilterOperator;
  value: string;
  metricLabel?: string;
  operatorLabel?: string;
}) {
  return (
    <>
      <TextField label={metricLabel} select size="small" sx={{ minWidth: { xs: "100%", sm: 130 } }} value={metric}
        onChange={(event) => onMetricChange(event.target.value as M)}>
        {Object.entries<{ label: string }>(metrics).map(([key, item]) => (
          <MenuItem key={key} value={key}>{item.label}</MenuItem>
        ))}
      </TextField>
      <TextField label={operatorLabel} select size="small" sx={{ width: { xs: "100%", sm: 100 } }} value={operator}
        onChange={(event) => onOperatorChange(event.target.value as NumericFilterOperator)}>
        {Object.entries(numericFilter.operators).map(([key, item]) => (
          <MenuItem key={key} value={key}>{item.label}</MenuItem>
        ))}
      </TextField>
      <TextField label="Value" size="small" slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 100 } }} type="number" value={value}
        onChange={(event) => onValueChange(event.target.value)} />
    </>
  );
}
