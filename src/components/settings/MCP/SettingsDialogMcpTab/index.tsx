"use client";

import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useSnackbar } from "notistack";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

import SettingsDialogSection from "../../Components/SettingsDialogSection";
import SettingsDialogMcpToolPreview, {
  type McpToolCatalogItem,
} from "../SettingsDialogMcpToolPreview";

import { McpUsageSnippet } from "./McpUsageSnippet";
import { PermissionChecklist } from "./PermissionChecklist";
import { MCP_PERMISSION_PRESETS } from "./permissions";
import { TokenCard } from "./TokenCard";
import type {
  McpCreateResponse,
  McpRevealResponse,
  McpTokenRecord,
  McpTokensResponse,
} from "./types";

type McpClient = "chatgpt" | "codex" | "mcporter";

const READ_ONLY = MCP_PERMISSION_PRESETS[0].permissions;

function errorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error ?? error?.message ?? fallback;
}

/** Bordered block with a title row, used for each part of the tab. */
function Panel({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <Box
      sx={(theme) => ({
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        p: 1.5,
      })}
    >
      <Stack alignItems="center" direction="row" spacing={1} sx={{ mb: 1.25, minHeight: 30 }}>
        <Typography fontWeight={700} sx={{ flexGrow: 1 }} variant="body2">
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

export default function SettingsDialogMcpTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
  const [tools, setTools] = useState<McpToolCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenPermissions, setNewTokenPermissions] =
    useState<RuntimeMcpPermission[]>(READ_ONLY);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [visibleTokens, setVisibleTokens] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");
  const [client, setClient] = useState<McpClient>("chatgpt");

  const mcpBaseUrl = `${origin || "https://fast.reinventwp.com"}${endpoints.mcp}`;
  const isLocalhost = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(mcpBaseUrl);
  const activeTokens = tokens.filter((token) => token.enabled).length;

  const snippets = useMemo<Record<McpClient, { hint: string; value: string }>>(
    () => ({
      chatgpt: {
        hint: "In ChatGPT, add a custom connector with this URL and choose No Auth. The token is part of the URL, so keep it private.",
        value: `${mcpBaseUrl}/<token>`,
      },
      codex: {
        hint: "Run in a terminal. Codex reads the token from the MCP_TOKEN environment variable.",
        value: `export MCP_TOKEN="<token>"\ncodex mcp add precision-mcp --url ${mcpBaseUrl} --bearer-token-env-var MCP_TOKEN`,
      },
      mcporter: {
        hint: "Run in a terminal to register this instance with mcporter.",
        value: `mcporter config add precision-mcp --scope home --url ${mcpBaseUrl} --transport http --header "Authorization=Bearer <token>"`,
      },
    }),
    [mcpBaseUrl],
  );

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get<McpTokensResponse>(endpoints.system.mcpTokens);
      setTokens(response.data.tokens ?? []);
      setTools(response.data.tools ?? []);
    } catch (error: any) {
      enqueueSnackbar(errorMessage(error, "Failed to load MCP tokens"), { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const updateToken = async (
    token: McpTokenRecord,
    patch: Partial<Pick<McpTokenRecord, "enabled" | "name" | "permissions">>,
  ) => {
    setSavingId(token.id);
    try {
      const response = await axios.patch<McpTokensResponse>(endpoints.system.mcpTokens, {
        id: token.id,
        ...patch,
      });
      setTokens(response.data.tokens ?? []);
      enqueueSnackbar("MCP token updated", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(errorMessage(error, "Failed to update MCP token"), { variant: "error" });
    } finally {
      setSavingId(null);
    }
  };

  const deleteToken = async (token: McpTokenRecord) => {
    if (!confirm(`Delete MCP token "${token.name}"? Clients using it will stop working.`)) {
      return;
    }

    setSavingId(token.id);
    try {
      const response = await axios.delete<McpTokensResponse>(endpoints.system.mcpTokens, {
        data: { id: token.id },
      });
      setTokens(response.data.tokens ?? []);
      enqueueSnackbar("MCP token deleted", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(errorMessage(error, "Failed to delete MCP token"), { variant: "error" });
    } finally {
      setSavingId(null);
    }
  };

  const openCreate = () => {
    setNewTokenName("");
    setNewTokenPermissions(READ_ONLY);
    setCreating(true);
  };

  const createToken = async () => {
    setSavingId("new");
    try {
      const response = await axios.post<McpCreateResponse>(endpoints.system.mcpTokens, {
        name: newTokenName.trim() || "MCP client",
        permissions: newTokenPermissions,
      });
      setVisibleTokens((current) => ({
        ...current,
        [response.data.record.id]: response.data.token,
      }));
      setTokens((current) => [...current, response.data.record]);
      setCreatedId(response.data.record.id);
      setCreating(false);
      enqueueSnackbar("MCP token created", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(errorMessage(error, "Failed to create MCP token"), { variant: "error" });
    } finally {
      setSavingId(null);
    }
  };

  const revealToken = async (token: McpTokenRecord) => {
    setSavingId(token.id);
    try {
      const response = await axios.post<McpRevealResponse>(endpoints.system.mcpTokens, {
        action: "reveal",
        id: token.id,
      });
      setVisibleTokens((current) => ({ ...current, [token.id]: response.data.token }));
    } catch (error: any) {
      enqueueSnackbar(errorMessage(error, "Failed to reveal MCP token"), { variant: "error" });
    } finally {
      setSavingId(null);
    }
  };

  const hideSecret = (tokenId: string) => {
    setVisibleTokens((current) => {
      const next = { ...current };
      delete next[tokenId];
      return next;
    });
  };

  return (
    <SettingsDialogSection
      title="MCP"
      description="Let ChatGPT, Codex and other MCP clients read or manage this instance. Each client connects with its own token, and the token's permissions decide which tools it can call."
    >
      <Stack spacing={2}>
        {/* Status and endpoint */}
        <Stack
          alignItems={{ xs: "stretch", sm: "center" }}
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={(theme) => ({
            backgroundColor: theme.palette.action.hover,
            borderRadius: 1.5,
            px: 1.5,
            py: 1,
          })}
        >
          <Chip
            color={activeTokens > 0 ? "success" : "warning"}
            label={
              activeTokens > 0
                ? `On · ${activeTokens} active ${activeTokens === 1 ? "token" : "tokens"}`
                : "Off · no active token"
            }
            size="small"
            sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
            variant="outlined"
          />
          <Typography color="text.secondary" variant="caption">
            MCP URL
          </Typography>
          <Typography
            sx={{ flexGrow: 1, fontFamily: "monospace", fontSize: "0.85rem", minWidth: 0, wordBreak: "break-all" }}
          >
            {mcpBaseUrl}
          </Typography>
          <Tooltip title="Copy MCP URL">
            <IconButton
              aria-label="Copy MCP URL"
              onClick={() => {
                void navigator.clipboard.writeText(mcpBaseUrl);
                enqueueSnackbar("Copied MCP URL", { variant: "success" });
              }}
              size="small"
              sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* Tokens */}
        <Panel
          action={
            !creating && (
              <Button onClick={openCreate} size="small" startIcon={<AddIcon />} variant="contained">
                New token
              </Button>
            )
          }
          title={tokens.length > 0 ? `Tokens (${tokens.length})` : "Tokens"}
        >
          <Stack spacing={1}>
            <Collapse in={creating} unmountOnExit>
              <Stack
                spacing={1.5}
                sx={(theme) => ({
                  border: `1px solid ${theme.palette.primary.main}`,
                  borderRadius: 1.5,
                  mb: 1,
                  p: 1.5,
                })}
              >
                <Typography fontWeight={700} variant="body2">
                  New token
                </Typography>
                <TextField
                  autoFocus
                  label="Name"
                  onChange={(event) => setNewTokenName(event.target.value)}
                  placeholder="e.g. ChatGPT connector"
                  size="small"
                  sx={{ maxWidth: 360 }}
                  value={newTokenName}
                />
                <PermissionChecklist
                  checked={newTokenPermissions}
                  onChange={setNewTokenPermissions}
                />
                <SettingsDialogMcpToolPreview permissions={newTokenPermissions} tools={tools} />
                <Stack direction="row" justifyContent="flex-end" spacing={1}>
                  <Button disabled={savingId === "new"} onClick={() => setCreating(false)} size="small">
                    Cancel
                  </Button>
                  <Button
                    disabled={savingId !== null || newTokenPermissions.length === 0}
                    onClick={() => void createToken()}
                    size="small"
                    startIcon={savingId === "new" ? <CircularProgress size={14} /> : <AddIcon />}
                    variant="contained"
                  >
                    Create token
                  </Button>
                </Stack>
              </Stack>
            </Collapse>

            {createdId && visibleTokens[createdId] && (
              <Alert onClose={() => setCreatedId(null)} severity="success">
                Token created. Copy it below and paste it into your client; you can show it again later from this tab.
              </Alert>
            )}

            {loading && tokens.length === 0 ? (
              <Stack alignItems="center" direction="row" spacing={1} sx={{ py: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2">Loading tokens...</Typography>
              </Stack>
            ) : tokens.length === 0 && !creating ? (
              <Stack alignItems="center" spacing={1} sx={{ py: 3, textAlign: "center" }}>
                <Typography variant="body2">No tokens yet, so MCP is off.</Typography>
                <Typography color="text.secondary" variant="caption">
                  Create a token for each client you want to connect.
                </Typography>
                <Button onClick={openCreate} size="small" startIcon={<AddIcon />} variant="outlined">
                  Create the first token
                </Button>
              </Stack>
            ) : (
              tokens.map((token) => (
                <TokenCard
                  key={token.id}
                  onDelete={(target) => void deleteToken(target)}
                  onHideSecret={hideSecret}
                  onReveal={(target) => void revealToken(target)}
                  onUpdate={(target, patch) => void updateToken(target, patch)}
                  saving={savingId === token.id}
                  token={token}
                  tools={tools}
                  visibleSecret={visibleTokens[token.id]}
                />
              ))
            )}
          </Stack>
        </Panel>

        {/* Client setup */}
        <Panel
          action={
            <ToggleButtonGroup
              exclusive
              onChange={(_event, value: McpClient | null) => value && setClient(value)}
              size="small"
              value={client}
            >
              <ToggleButton sx={{ px: 1.25, py: 0.25, textTransform: "none" }} value="chatgpt">
                ChatGPT
              </ToggleButton>
              <ToggleButton sx={{ px: 1.25, py: 0.25, textTransform: "none" }} value="codex">
                Codex
              </ToggleButton>
              <ToggleButton sx={{ px: 1.25, py: 0.25, textTransform: "none" }} value="mcporter">
                mcporter
              </ToggleButton>
            </ToggleButtonGroup>
          }
          title="Connect a client"
        >
          <Stack spacing={1}>
            <Typography color="text.secondary" variant="caption">
              {snippets[client].hint} Replace <code>&lt;token&gt;</code> with a token from above.
            </Typography>
            <McpUsageSnippet value={snippets[client].value} />
            {client === "chatgpt" && isLocalhost && (
              <Alert severity="warning" sx={{ py: 0 }}>
                ChatGPT cannot reach localhost. Use the online site URL or an HTTPS tunnel.
              </Alert>
            )}
          </Stack>
        </Panel>
      </Stack>
    </SettingsDialogSection>
  );
}
