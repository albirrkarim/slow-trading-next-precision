"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Box,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import indicators, {
  INDICATOR_ID_PATTERN,
  INDICATOR_INTERVALS,
  type FeatureIndicatorConfig,
  type FeatureIndicatorInterval,
  type IndicatorField,
} from "@/lib/features/indicators";

import CommitField from "./CommitField";

const FIELD_SX = { width: 120 } as const;

/** Parses a finite number inside the field's range. */
function numberParser(field: Extract<IndicatorField, { kind: "integer" | "number" }>) {
  return (text: string) => {
    const value = Number(text);
    if (
      !Number.isFinite(value) ||
      value < field.min ||
      value > field.max ||
      (field.kind === "integer" && !Number.isInteger(value))
    ) {
      return { error: `${field.kind === "integer" ? "Integer" : "Number"} ${field.min}–${field.max}` };
    }
    return { value };
  };
}

/** One type-specific param, rendered from its registry field metadata. */
function IndicatorFieldInput({
  field,
  value,
  onChange,
}: {
  field: IndicatorField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === "select") {
    return (
      <TextField
        label={field.label}
        onChange={(event) => onChange(event.target.value)}
        select
        size="small"
        sx={FIELD_SX}
        value={value}
      >
        {field.options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <CommitField
      label={field.label}
      onCommit={onChange}
      parse={numberParser(field)}
      size="small"
      sx={FIELD_SX}
      value={value as number}
    />
  );
}

export default function FeatureIndicatorCard({
  item,
  takenIds,
  onChange,
  onDuplicate,
  onRemove,
}: {
  item: FeatureIndicatorConfig;
  /** Ids used by the other instances. */
  takenIds: Set<string>;
  onChange: (patch: Partial<FeatureIndicatorConfig>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const enabled = item.on !== false;
  const definition = indicators.registry.of(item);
  return (
    <Paper sx={{ p: 1.5, opacity: enabled ? 1 : 0.6 }} variant="outlined">
      <Box sx={{ alignItems: "center", display: "flex", gap: 1, mb: 1.5 }}>
        <Chip label={definition.label} size="small" />
        <Typography color="text.secondary" sx={{ flex: 1, minWidth: 0 }} variant="caption">
          {indicators.config.summary(item)} · <code>ind.{item.type}.{item.id}</code>
        </Typography>
        <Tooltip title={enabled ? "Disable (keeps the config)" : "Enable"}>
          <Switch checked={enabled} onChange={(_, on) => onChange({ on: on ? undefined : false })} size="small" />
        </Tooltip>
        <Tooltip title="Duplicate">
          <IconButton onClick={onDuplicate} size="small">
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Remove">
          <IconButton onClick={onRemove} size="small">
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <CommitField
          label="Id"
          onCommit={(id: string) => onChange({ id })}
          parse={(text) =>
            !INDICATOR_ID_PATTERN.test(text)
              ? { error: "a–z first; a–z 0–9 _ (max 16)" }
              : takenIds.has(text)
                ? { error: "Id already used" }
                : { value: text }
          }
          size="small"
          sx={{ width: 150 }}
          value={item.id}
        />
        <TextField
          label="Interval"
          onChange={(event) => onChange({ interval: event.target.value as FeatureIndicatorInterval })}
          select
          size="small"
          sx={FIELD_SX}
          value={item.interval}
        >
          {INDICATOR_INTERVALS.map((interval) => (
            <MenuItem key={interval} value={interval}>
              {interval}
            </MenuItem>
          ))}
        </TextField>
        {(definition.fields as readonly IndicatorField[]).map((field) => (
          <IndicatorFieldInput
            field={field}
            key={field.key}
            onChange={(value) => onChange({ [field.key]: value } as Partial<FeatureIndicatorConfig>)}
            value={(item as unknown as Record<string, unknown>)[field.key]}
          />
        ))}
      </Box>
    </Paper>
  );
}
