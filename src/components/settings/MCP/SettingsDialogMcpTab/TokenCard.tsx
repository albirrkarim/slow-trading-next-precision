"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyIcon from "@mui/icons-material/Key";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useSnackbar } from "notistack";
import { useState } from "react";

import SettingsDialogMcpToolPreview, {
  type McpToolCatalogItem,
} from "../SettingsDialogMcpToolPreview";

import {
  formatRelative,
  formatTimestamp,
  MCP_PERMISSION_PRESETS,
  MCP_PERMISSIONS,
  samePermissions,
} from "./permissions";
import { PermissionChecklist } from "./PermissionChecklist";
import type { McpTokenRecord } from "./types";

/** "Full access", "Read only", or "4 of 9 permissions". */
function accessLabel(token: McpTokenRecord): string {
  const preset = MCP_PERMISSION_PRESETS.find((item) =>
    samePermissions(item.permissions, token.permissions),
  );
  return preset?.label ?? `${token.permissions.length} of ${MCP_PERMISSIONS.length} permissions`;
}

/** One token as a compact row; expand it to rename or change permissions. */
export function TokenCard({
  defaultExpanded = false,
  onDelete,
  onReveal,
  onHideSecret,
  onUpdate,
  saving,
  token,
  tools,
  visibleSecret,
}: {
  defaultExpanded?: boolean;
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
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toolCount = tools.filter((tool) => token.permissions.includes(tool.permission)).length;

  return (
    <Box
      sx={(theme) => ({
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        opacity: token.enabled ? 1 : 0.7,
        transition: "opacity 120ms",
      })}
    >
      <Stack alignItems="center" direction="row" spacing={1} sx={{ px: 1.5, py: 1 }}>
        <KeyIcon color={token.enabled ? "success" : "disabled"} fontSize="small" />
        <Box
          onClick={() => setExpanded((value) => !value)}
          sx={{ cursor: "pointer", flexGrow: 1, minWidth: 0 }}
        >
          <Typography fontWeight={700} noWrap variant="body2">
            {token.name}
          </Typography>
          <Typography color="text.secondary" noWrap sx={{ display: "block" }} variant="caption">
            {accessLabel(token)} · {toolCount} {toolCount === 1 ? "tool" : "tools"} · last used{" "}
            <span title={formatTimestamp(token.lastUsedAt)}>{formatRelative(token.lastUsedAt)}</span>
          </Typography>
        </Box>

        <Tooltip title={token.enabled ? "Enabled: clients can connect. Click to disable." : "Disabled: clients are refused. Click to enable."}>
          <Switch
            checked={token.enabled}
            disabled={saving}
            onChange={(event) => onUpdate(token, { enabled: event.target.checked })}
            size="small"
          />
        </Tooltip>

        <Button
          disabled={saving || (!visibleSecret && !token.secretAvailable)}
          onClick={() => (visibleSecret ? onHideSecret(token.id) : onReveal(token))}
          size="small"
          startIcon={
            saving ? (
              <CircularProgress size={14} />
            ) : visibleSecret ? (
              <VisibilityOffIcon />
            ) : (
              <VisibilityIcon />
            )
          }
          title={token.secretAvailable ? undefined : "This token's secret was not stored and cannot be shown again."}
          variant="text"
        >
          {visibleSecret ? "Hide" : "Show"}
        </Button>

        <Tooltip title={expanded ? "Close" : "Edit name and permissions"}>
          <IconButton
            aria-expanded={expanded}
            aria-label="Edit token"
            onClick={() => setExpanded((value) => !value)}
            size="small"
          >
            <ExpandMoreIcon
              fontSize="small"
              sx={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
            />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete token">
          <span>
            <IconButton
              aria-label="Delete token"
              color="error"
              disabled={saving}
              onClick={() => onDelete(token)}
              size="small"
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {visibleSecret && (
        <Stack
          alignItems="center"
          direction="row"
          spacing={1}
          sx={(theme) => ({
            backgroundColor: theme.palette.action.hover,
            borderTop: `1px solid ${theme.palette.divider}`,
            px: 1.5,
            py: 1,
          })}
        >
          <Typography
            sx={{ flexGrow: 1, fontFamily: "monospace", fontSize: "0.8rem", minWidth: 0, wordBreak: "break-all" }}
          >
            {visibleSecret}
          </Typography>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(visibleSecret);
              enqueueSnackbar("Copied MCP token", { variant: "success" });
            }}
            size="small"
            startIcon={<ContentCopyIcon />}
            variant="contained"
          >
            Copy
          </Button>
        </Stack>
      )}

      <Collapse in={expanded} unmountOnExit>
        <Stack
          spacing={1.5}
          sx={(theme) => ({ borderTop: `1px solid ${theme.palette.divider}`, p: 1.5 })}
        >
          <TextField
            defaultValue={token.name}
            label="Token name"
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== token.name) onUpdate(token, { name });
            }}
            size="small"
            sx={{ maxWidth: 360 }}
          />
          <PermissionChecklist
            checked={token.permissions}
            disabled={saving}
            onChange={(permissions) => onUpdate(token, { permissions })}
          />
          <SettingsDialogMcpToolPreview permissions={token.permissions} tools={tools} />
          <Typography color="text.secondary" variant="caption">
            Created {formatTimestamp(token.createdAt)} · Last used {formatTimestamp(token.lastUsedAt)}
          </Typography>
        </Stack>
      </Collapse>
    </Box>
  );
}
