"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useSnackbar } from "notistack";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

import SettingsDialogMcpToolPreview, {
  type McpToolCatalogItem,
} from "../SettingsDialogMcpToolPreview";

import { formatTimestamp, togglePermission } from "./permissions";
import { PermissionChecklist } from "./PermissionChecklist";
import type { McpTokenRecord } from "./types";

export function TokenCard({
  onDelete,
  onReveal,
  onHideSecret,
  onUpdate,
  saving,
  token,
  tools,
  visibleSecret,
}: {
  onDelete: (token: McpTokenRecord) => void;
  onReveal: (token: McpTokenRecord) => void;
  onHideSecret: (tokenId: string) => void;
  onUpdate: (
    token: McpTokenRecord,
    patch: Partial<Pick<McpTokenRecord, "enabled" | "name" | "permissions">>,
  ) => void;
  saving: boolean;
  token: McpTokenRecord;
  tools: McpToolCatalogItem[];
  visibleSecret: string | undefined;
}) {
  const { enqueueSnackbar } = useSnackbar();

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
      }}
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: { xs: "1fr", md: "1fr auto auto auto" },
            alignItems: "center",
          }}
        >
          <TextField
            label="Token name"
            defaultValue={token.name}
            size="small"
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== token.name) {
                void onUpdate(token, { name });
              }
            }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={token.enabled}
                disabled={saving}
                onChange={(event) =>
                  void onUpdate(token, {
                    enabled: event.target.checked,
                  })
                }
              />
            }
            label={token.enabled ? "Enabled" : "Disabled"}
          />

          <Tooltip
            title={
              visibleSecret
                ? "Hide token secret"
                : "Show token secret"
            }
          >
            <span>
              <Button
                disabled={saving}
                onClick={() => {
                  if (visibleSecret) {
                    onHideSecret(token.id);
                    return;
                  }
                  void onReveal(token);
                }}
                size="small"
                startIcon={
                  saving ? (
                    <CircularProgress size={16} />
                  ) : visibleSecret ? (
                    <VisibilityOffIcon />
                  ) : (
                    <VisibilityIcon />
                  )
                }
                variant="outlined"
              >
                {visibleSecret ? "Hide" : "Show"}
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Delete token">
            <span>
              <IconButton
                color="error"
                disabled={saving}
                onClick={() => void onDelete(token)}
              >
                {saving ? (
                  <CircularProgress size={20} />
                ) : (
                  <DeleteIcon />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Typography color="text.secondary" variant="caption">
          Created {formatTimestamp(token.createdAt)} · Last used{" "}
          {formatTimestamp(token.lastUsedAt)}
        </Typography>

        {visibleSecret && (
          <Alert
            severity="success"
            variant="outlined"
            action={
              <Button
                color="inherit"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  void navigator.clipboard.writeText(
                    visibleSecret,
                  );
                  enqueueSnackbar("Copied MCP token", {
                    variant: "success",
                  });
                }}
              >
                Copy
              </Button>
            }
          >
            <Typography fontWeight={700} variant="body2">
              Token secret
            </Typography>
            <Typography
              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {visibleSecret}
            </Typography>
          </Alert>
        )}

        <PermissionChecklist
          checked={token.permissions}
          columns={3}
          disabled={saving}
          onToggle={(permission: RuntimeMcpPermission) =>
            void onUpdate(token, {
              permissions: togglePermission(
                token.permissions,
                permission,
              ),
            })
          }
        />

        <SettingsDialogMcpToolPreview
          permissions={token.permissions}
          tools={tools}
        />
      </Stack>
    </Box>
  );
}
