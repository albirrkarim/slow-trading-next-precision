"use client";

import { useMemo, useState } from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import type { ConfigDraft, ConfigDraftSetter } from "../settings-types";

const REQUIRED_CONFIG_KEYS = [
  "management",
  "runtime",
  "accounts",
] as const satisfies ReadonlyArray<keyof ConfigDraft>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serializes the complete editable dashboard configuration for backup.
 */
export function stringifyConfigBackup(configDraft: ConfigDraft): string {
  return JSON.stringify(configDraft, null, 2);
}

/**
 * Parses and validates a complete dashboard configuration backup.
 */
export function parseConfigBackup(raw: string): ConfigDraft {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The pasted value is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("The backup must be a JSON object.");
  }

  const missingKey = REQUIRED_CONFIG_KEYS.find(
    (key) => !Object.prototype.hasOwnProperty.call(parsed, key),
  );

  if (missingKey) {
    throw new Error(`The backup is missing the required "${missingKey}" field.`);
  }

  if (
    !Array.isArray(parsed.accounts) ||
    !isRecord(parsed.management) ||
    !isRecord(parsed.runtime)
  ) {
    throw new Error(
      "The backup must contain management, runtime, and accounts groups.",
    );
  }

  return structuredClone(parsed) as unknown as ConfigDraft;
}

export default function SettingsDialogBackupTab({
  configDraft,
  setConfigDraft,
}: {
  configDraft: ConfigDraft;
  setConfigDraft: ConfigDraftSetter;
}) {
  const backupJson = useMemo(
    () => stringifyConfigBackup(configDraft),
    [configDraft],
  );
  const [importJson, setImportJson] = useState("");
  const [message, setMessage] = useState<{
    severity: "error" | "success";
    text: string;
  } | null>(null);

  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(backupJson);
      setMessage({
        severity: "success",
        text: "Full configuration JSON copied.",
      });
    } catch {
      setMessage({
        severity: "error",
        text: "Could not access the clipboard. Select and copy the JSON manually.",
      });
    }
  };

  const loadBackup = () => {
    try {
      const importedConfig = parseConfigBackup(importJson);
      setConfigDraft(importedConfig);
      setMessage({
        severity: "success",
        text: "Backup loaded into the settings draft. Review it, then choose Save to persist it.",
      });
    } catch (error) {
      setMessage({
        severity: "error",
        text:
          error instanceof Error
            ? error.message
            : "The configuration backup could not be loaded.",
      });
    }
  };

  return (
    <Stack gap={2}>
      <Alert severity="warning">
        This full backup contains exchange API credentials, notification
        destinations, withdrawal wallets, and all other settings. Store and
        share it securely.
      </Alert>

      {message && <Alert severity={message.severity}>{message.text}</Alert>}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack gap={1}>
            <Box>
              <Typography fontWeight={700} variant="subtitle1">
                Copy Config
              </Typography>
              <Typography color="text.secondary" variant="caption">
                Current settings draft
              </Typography>
            </Box>
            <TextField
              fullWidth
              maxRows={22}
              minRows={14}
              multiline
              slotProps={{
                htmlInput: {
                  "aria-label": "Current full configuration JSON",
                  readOnly: true,
                },
              }}
              value={backupJson}
            />
            <Button
              onClick={() => {
                void copyBackup();
              }}
              startIcon={<ContentCopyIcon />}
              variant="outlined"
            >
              Copy Full JSON
            </Button>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack gap={1}>
            <Box>
              <Typography fontWeight={700} variant="subtitle1">
                Restore Config
              </Typography>
              <Typography color="text.secondary" variant="caption">
                Paste a complete configuration backup
              </Typography>
            </Box>
            <TextField
              fullWidth
              maxRows={22}
              minRows={14}
              multiline
              onChange={(event) => {
                setImportJson(event.target.value);
                setMessage(null);
              }}
              placeholder='{ "name": "...", ... }'
              slotProps={{
                htmlInput: {
                  "aria-label": "Paste full configuration JSON",
                },
              }}
              value={importJson}
            />
            <Button
              disabled={!importJson.trim()}
              onClick={loadBackup}
              startIcon={<UploadFileIcon />}
              variant="contained"
            >
              Load JSON Into Settings
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
