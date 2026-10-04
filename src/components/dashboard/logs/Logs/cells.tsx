"use client";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  alpha,
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";

import { formatConfigValue } from "./utils";

export function DeleteLogButton(props: {
  deleting: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const { deleting, disabled, onDelete } = props;

  return (
    <Tooltip title="Delete log record">
      <span>
        <IconButton
          aria-label="Delete log record"
          color="error"
          disabled={disabled}
          onClick={onDelete}
          size="small"
        >
          {deleting ? (
            <CircularProgress color="inherit" size={18} />
          ) : (
            <DeleteOutlineIcon fontSize="small" />
          )}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export function ConfigChangeValue(props: {
  side: "next" | "previous";
  value: unknown;
}) {
  const { side, value } = props;

  if (value === undefined) {
    return (
      <Typography
        color="text.disabled"
        component="span"
        sx={{ fontStyle: "italic" }}
        variant="caption"
      >
        —
      </Typography>
    );
  }

  const color = side === "previous" ? "error" : "success";
  const text = formatConfigValue(value);
  return (
    <Tooltip title={text}>
      <Box
        component="span"
        sx={(theme) => ({
          bgcolor: alpha(theme.palette[color].main, 0.12),
          borderRadius: 1,
          color: theme.palette[color].dark,
          display: "inline-block",
          fontFamily: "monospace",
          fontSize: 12,
          maxWidth: 280,
          overflow: "hidden",
          px: 0.75,
          py: 0.25,
          textOverflow: "ellipsis",
          verticalAlign: "middle",
          whiteSpace: "nowrap",
        })}
      >
        {text}
      </Box>
    </Tooltip>
  );
}

export function ConfigPath(props: { path: string }) {
  const segments = props.path.split(".");
  const leaf = segments.pop() ?? props.path;

  return (
    <>
      {segments.length > 0 && (
        <Box component="span" sx={{ color: "text.secondary" }}>
          {segments.join(".")}.
        </Box>
      )}
      <Box component="span" sx={{ fontWeight: 700 }}>
        {leaf}
      </Box>
    </>
  );
}
