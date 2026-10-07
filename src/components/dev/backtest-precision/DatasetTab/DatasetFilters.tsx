"use client";

import { Box, Button, Checkbox, FormControlLabel, MenuItem, TextField } from "@mui/material";

import MetricCondition from "@/components/ui/MetricCondition";
import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateRowMetric } from "@/lib/dev/feature-gate";
import type { NumericFilterOperator } from "@/lib/system/utils/numeric-filter";

export interface DatasetFilterValues {
  symbol: string;
  resolvedOnly: boolean;
  from: string;
  to: string;
  metric: FeatureGateRowMetric;
  operator: NumericFilterOperator;
  value: string;
}

export const EMPTY_DATASET_FILTERS: DatasetFilterValues = {
  symbol: "", resolvedOnly: false, from: "", to: "", metric: "missScore", operator: "eq", value: "",
};

export default function DatasetFilters({ filters, onChange, symbols }: {
  filters: DatasetFilterValues;
  onChange: (filters: DatasetFilterValues) => void;
  symbols: string[];
}) {
  const hasFilters = filters.symbol || filters.resolvedOnly || filters.from || filters.to || filters.value;
  return (
    <Box sx={{ alignItems: { xs: "stretch", sm: "center" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      <TextField label="Symbol" select size="small" sx={{ minWidth: 120 }} value={filters.symbol}
        onChange={(event) => onChange({ ...filters, symbol: event.target.value })}>
        <MenuItem value="">All symbols</MenuItem>
        {symbols.map((symbol) => <MenuItem key={symbol} value={symbol}>{symbol}</MenuItem>)}
      </TextField>
      <FormControlLabel label="Resolved only" control={<Checkbox size="small" checked={filters.resolvedOnly}
        onChange={(event) => onChange({ ...filters, resolvedOnly: event.target.checked })} />} />
      <TextField label="Capture from" type="date" size="small" slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 150 } }} value={filters.from}
        onChange={(event) => onChange({ ...filters, from: event.target.value })} />
      <TextField label="Capture to" type="date" size="small" slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 150 } }} value={filters.to}
        onChange={(event) => onChange({ ...filters, to: event.target.value })} />
      <MetricCondition metricLabel="What" operatorLabel="Operator" metric={filters.metric} metrics={datasetFilters.metrics}
        onMetricChange={(metric) => onChange({ ...filters, metric })}
        onOperatorChange={(operator) => onChange({ ...filters, operator })}
        onValueChange={(value) => onChange({ ...filters, value })}
        operator={filters.operator} value={filters.value} />
      {hasFilters && <Button size="small" onClick={() => onChange(EMPTY_DATASET_FILTERS)}>Clear</Button>}
    </Box>
  );
}
