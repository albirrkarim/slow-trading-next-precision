"use client";

import { Box, Button, MenuItem, TextField } from "@mui/material";

import MetricCondition from "@/components/ui/MetricCondition";
import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateInfo } from "@/lib/dev/feature-gate";

import filterStorage from "./filter-storage";
import type { DatasetFilterValues } from "./filter-storage";

export default function DatasetFilters({ filters, onChange, symbols, gates, slug, onSlugChange }: {
  filters: DatasetFilterValues;
  onChange: (filters: DatasetFilterValues) => void;
  symbols: string[];
  gates: FeatureGateInfo[];
  slug: string;
  onSlugChange: (slug: string) => void;
}) {
  const hasFilters = filters.symbol || filters.from || filters.to || filters.value ||
    filters.metric !== filterStorage.defaults.metric || filters.operator !== filterStorage.defaults.operator;
  const symbolOptions = filters.symbol && !symbols.includes(filters.symbol) ? [filters.symbol, ...symbols] : symbols;
  return (
    <Box sx={{ alignItems: { xs: "stretch", sm: "center" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      <TextField label="Symbol" select size="small" sx={{ minWidth: 120 }} value={filters.symbol}
        onChange={(event) => onChange({ ...filters, symbol: event.target.value })}>
        <MenuItem value="">All symbols</MenuItem>
        {symbolOptions.map((symbol) => <MenuItem key={symbol} value={symbol}>{symbol}</MenuItem>)}
      </TextField>
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
      {hasFilters && <Button size="small" onClick={() => onChange(filterStorage.defaults)}>Clear</Button>}
      <TextField label="Feature gate" select size="small" sx={{ minWidth: 230 }} value={slug}
        onChange={(event) => onSlugChange(event.target.value)}>
        {gates.map((gate) => <MenuItem key={gate.slug} value={gate.slug}>{gate.label}</MenuItem>)}
      </TextField>
    </Box>
  );
}
