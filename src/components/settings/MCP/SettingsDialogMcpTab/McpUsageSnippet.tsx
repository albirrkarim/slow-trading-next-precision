"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, IconButton, Tooltip } from "@mui/material";
import { useSnackbar } from "notistack";

/** A copyable setup snippet. */
export function McpUsageSnippet({ value }: { value: string }) {
  const { enqueueSnackbar } = useSnackbar();

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        component="pre"
        sx={(theme) => ({
          backgroundColor: theme.palette.action.hover,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          fontFamily: "monospace",
          fontSize: "0.78rem",
          lineHeight: 1.5,
          m: 0,
          overflowX: "auto",
          p: 1.25,
          pr: 5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        })}
      >
        {value}
      </Box>
      <Tooltip title="Copy">
        <IconButton
          aria-label="Copy snippet"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            enqueueSnackbar("Copied", { variant: "success" });
          }}
          size="small"
          sx={{ position: "absolute", right: 4, top: 4 }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
