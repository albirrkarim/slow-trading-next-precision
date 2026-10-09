"use client";

import { Box, Button, Checkbox, FormControl, FormControlLabel, FormGroup, InputLabel, ListItemText, MenuItem, Select, TextField, Typography } from "@mui/material";

import MetricCondition from "@/components/ui/MetricCondition";
import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateInfo } from "@/lib/dev/feature-gate";

import filterStorage from "./filter-storage";
import type { DatasetFilterValues } from "./filter-storage";

export default function DatasetFilters({ filters, onChange, symbols, gates, slug, onSlugChange, enabledSubGates, onSubGatesChange, entryReasons }: {
  filters: DatasetFilterValues;
  onChange: (filters: DatasetFilterValues) => void;
  symbols: string[];
  gates: FeatureGateInfo[];
  slug: string;
  onSlugChange: (slug: string) => void;
  enabledSubGates: string[];
  onSubGatesChange: (gates: string[]) => void;
  entryReasons: { reason: string; count: number }[];
}) {
  const hasFilters = filters.symbols !== null || filters.from || filters.to || filters.value ||
    filters.entryStatus || filters.entryReason ||
    filters.metric !== filterStorage.defaults.metric || filters.operator !== filterStorage.defaults.operator;
  const symbolOptions = [...new Set([...symbols, ...(filters.symbols ?? [])])].sort();
  const selectedSymbols = filters.symbols ?? symbolOptions;
  const reasonOptions = filters.entryReason && !entryReasons.some((item) => item.reason === filters.entryReason)
    ? [{ reason: filters.entryReason, count: 0 }, ...entryReasons] : entryReasons;
  const subGates = gates.find((gate) => gate.slug === slug)?.subGates;
  const subGateKeys = Object.keys(subGates ?? {});
  return (
    <Box sx={{ alignItems: { xs: "stretch", sm: "center" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel id="dataset-symbol-label">Symbol</InputLabel>
        <Select<string[]> label="Symbol" labelId="dataset-symbol-label" multiple value={selectedSymbols}
          renderValue={(selected) => selected.length === symbolOptions.length ? "All symbols" :
            selected.length === 0 ? "No symbols" : `${selected.length} of ${symbolOptions.length} symbols`}
          onChange={(event) => {
            const selected = typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value;
            onChange({ ...filters, symbols: selected.includes("__all__") || selected.length === symbolOptions.length ? null : selected });
          }}>
          <MenuItem value="__all__"><Checkbox checked={selectedSymbols.length === symbolOptions.length} size="small" /><ListItemText primary="All symbols" /></MenuItem>
          {symbolOptions.map((symbol) => <MenuItem key={symbol} value={symbol}>
            <Checkbox checked={selectedSymbols.includes(symbol)} size="small" /><ListItemText primary={symbol} />
          </MenuItem>)}
        </Select>
      </FormControl>
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
      <TextField label="Entry" select size="small" sx={{ minWidth: 130 }} value={filters.entryStatus}
        onChange={(event) => onChange({ ...filters, entryStatus: event.target.value as DatasetFilterValues["entryStatus"], entryReason: "" })}>
        <MenuItem value="">All entries</MenuItem>
        <MenuItem value="pass">Pass</MenuItem>
        <MenuItem value="blocked">Blocked</MenuItem>
      </TextField>
      <TextField label="Entry reason" select size="small" sx={{ minWidth: 230, maxWidth: 400 }} value={filters.entryReason}
        onChange={(event) => onChange({ ...filters, entryReason: event.target.value })}>
        <MenuItem value="">All reasons</MenuItem>
        {reasonOptions.length === 0 && <MenuItem disabled value="__no_reasons__">
          {filters.entryStatus === "pass" ? "No Pass messages" : filters.entryStatus === "blocked" ? "No Blocked messages" : "No gate messages yet"}
        </MenuItem>}
        {reasonOptions.map(({ reason, count }) => <MenuItem key={reason} sx={{ maxWidth: 540, whiteSpace: "normal", overflowWrap: "anywhere" }} value={reason}>
          {count.toLocaleString()}× {reason}
        </MenuItem>)}
      </TextField>
      {hasFilters && <Button size="small" onClick={() => onChange(filterStorage.defaults)}>Clear</Button>}
      <TextField label="Feature gate" select size="small" sx={{ minWidth: 230 }} value={slug}
        onChange={(event) => onSlugChange(event.target.value)}>
        {gates.map((gate) => <MenuItem key={gate.slug} value={gate.slug}>{gate.label}</MenuItem>)}
      </TextField>
      {subGates && <Box sx={{ width: "100%" }}>
        <Typography color="text.secondary" variant="body2">{slug.toUpperCase()} subgates</Typography>
        <FormGroup aria-label={`${slug.toUpperCase()} subgates`} row sx={{ columnGap: 1, rowGap: 0 }}>
          {Object.entries(subGates).map(([gate, label]) => <FormControlLabel key={gate} label={label}
            control={<Checkbox checked={enabledSubGates.includes(gate)} size="small"
              onChange={(_, checked) => onSubGatesChange(subGateKeys.filter((item) =>
                item === gate ? checked : enabledSubGates.includes(item)))} />}
            sx={{ mr: 1 }} />)}
        </FormGroup>
      </Box>}
    </Box>
  );
}
