"use client";

import SaveIcon from "@mui/icons-material/Save";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import axios from "axios";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useState } from "react";

import { endpoints } from "@/components/endpoints";


import SettingsDialogSection from "../../Components/SettingsDialogSection";
import SettingsDialogMcpToolPreview, {
  type McpToolCatalogItem,
} from "../SettingsDialogMcpToolPreview";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

import { McpUsageSnippet } from "./McpUsageSnippet";
import { PermissionChecklist } from "./PermissionChecklist";
import { MCP_PERMISSIONS, togglePermission } from "./permissions";
import { TokenCard } from "./TokenCard";
import type {
  McpCreateResponse,
  McpRevealResponse,
  McpTokenRecord,
  McpTokensResponse,
} from "./types";

export default function SettingsDialogMcpTab() {
  const { enqueueSnackbar } = useSnackbar();
  const allPermissionKeys = useMemo(
    () => MCP_PERMISSIONS.map((permission) => permission.key),
    [],
  );
  const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
  const [tools, setTools] = useState<McpToolCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState("ChatGPT connector");
  const [newTokenPermissions, setNewTokenPermissions] =
    useState<RuntimeMcpPermission[]>(allPermissionKeys);
  const [visibleTokens, setVisibleTokens] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");

  const mcpBaseUrl = `${origin || "https://fast.reinventwp.com"}${endpoints.mcp}`;

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get<McpTokensResponse>(
        endpoints.system.mcpTokens,
      );
      setTokens(response.data.tokens ?? []);
      setTools(response.data.tools ?? []);
    } catch (error: any) {
      enqueueSnackbar(
        error.response?.data?.error ?? error.message ?? "Failed to load MCP tokens",
        { variant: "error" },
      );
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
      const response = await axios.patch<McpTokensResponse>(
        endpoints.system.mcpTokens,
        {
          id: token.id,
          ...patch,
        },
      );
      setTokens(response.data.tokens ?? []);
      setVisibleTokens((current) => {
        const next = { ...current };
        delete next[token.id];
        return next;
      });
      enqueueSnackbar("MCP token updated", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(
        error.response?.data?.error ?? error.message ?? "Failed to update MCP token",
        { variant: "error" },
      );
    } finally {
      setSavingId(null);
    }
  };

  const deleteToken = async (token: McpTokenRecord) => {
    if (!confirm(`Delete MCP token "${token.name}"? Agents using it will stop working.`)) {
      return;
    }

    setSavingId(token.id);
    try {
      const response = await axios.delete<McpTokensResponse>(
        endpoints.system.mcpTokens,
        {
          data: {
            id: token.id,
          },
        },
      );
      setTokens(response.data.tokens ?? []);
      enqueueSnackbar("MCP token deleted", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(
        error.response?.data?.error ?? error.message ?? "Failed to delete MCP token",
        { variant: "error" },
      );
    } finally {
      setSavingId(null);
    }
  };

  const createToken = async () => {
    setSavingId("new");
    try {
      const response = await axios.post<McpCreateResponse>(
        endpoints.system.mcpTokens,
        {
          name: newTokenName,
          permissions: newTokenPermissions,
        },
      );
      setVisibleTokens((current) => ({
        ...current,
        [response.data.record.id]: response.data.token,
      }));
      setTokens((current) => [...current, response.data.record]);
      enqueueSnackbar("MCP token created", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(
        error.response?.data?.error ?? error.message ?? "Failed to create MCP token",
        { variant: "error" },
      );
    } finally {
      setSavingId(null);
    }
  };

  const revealToken = async (token: McpTokenRecord) => {
    setSavingId(token.id);
    try {
      const response = await axios.post<McpRevealResponse>(
        endpoints.system.mcpTokens,
        {
          action: "reveal",
          id: token.id,
        },
      );
      setVisibleTokens((current) => ({
        ...current,
        [token.id]: response.data.token,
      }));
      enqueueSnackbar("MCP token secret shown", { variant: "success" });
    } catch (error: any) {
      enqueueSnackbar(
        error.response?.data?.error ?? error.message ?? "Failed to reveal MCP token",
        { variant: "error" },
      );
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
      description="Generate bearer tokens for ChatGPT, Codex, and other MCP clients. The MCP URL is /api/mcp on this site."
    >
      <Stack spacing={2.5}>
        <Alert severity={tokens.length > 0 ? "info" : "warning"}>
          {tokens.length > 0
            ? "MCP is enabled for active tokens only. New token secrets are encrypted and can be shown again from this tab."
            : "MCP is disabled until you create and enable at least one token."}
        </Alert>

        <Box
          sx={(theme) => ({
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            p: 1.5,
          })}
        >
          <Typography fontWeight={700} variant="body2">
            Quick setup
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
            Create a token, click Show, then use the token in one of these clients.
            Keep the token and ChatGPT URL private.
          </Typography>

          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              mt: 1.5,
            }}
          >
            <McpUsageSnippet
              label="ChatGPT Connector"
              value={`${mcpBaseUrl}/<token>\nAuth: No Auth`}
            />
            <McpUsageSnippet
              label="Codex"
              value={`export SLOW_MCP_TOKEN="<token>"\ncodex mcp add slow-mcp --url ${mcpBaseUrl} --bearer-token-env-var SLOW_MCP_TOKEN`}
            />
            <McpUsageSnippet
              label="mcporter"
              value={`mcporter config add slow-mcp --scope home --url ${mcpBaseUrl} --transport http --header "Authorization=Bearer <token>"`}
            />
          </Box>

          <Typography color="text.secondary" variant="caption" sx={{ mt: 1, display: "block" }}>
            ChatGPT cannot reach localhost directly; use the online site URL or an HTTPS tunnel.
          </Typography>
        </Box>

        <Box
          sx={(theme) => ({
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            p: 1.5,
          })}
        >
          <Typography fontWeight={700} variant="body2">
            Create token
          </Typography>

          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(220px, 320px) 1fr auto",
              },
              alignItems: "start",
              mt: 1.5,
            }}
          >
            <TextField
              label="New token name"
              value={newTokenName}
              onChange={(event) => setNewTokenName(event.target.value)}
              size="small"
            />

            <PermissionChecklist
              checked={newTokenPermissions}
              columns={2}
              onToggle={(permission) =>
                setNewTokenPermissions((current) =>
                  togglePermission(current, permission),
                )
              }
            />

            <Button
              disabled={savingId !== null || newTokenPermissions.length === 0}
              onClick={() => void createToken()}
              startIcon={
                savingId === "new" ? <CircularProgress size={16} /> : <SaveIcon />
              }
              variant="contained"
            >
              Create
            </Button>
          </Box>

          <Box sx={{ mt: 1.5 }}>
            <SettingsDialogMcpToolPreview
              permissions={newTokenPermissions}
              tools={tools}
            />
          </Box>
        </Box>

        <Divider />

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="body2">Loading MCP tokens...</Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            {tokens.length === 0 && (
              <Typography color="text.secondary" variant="body2">
                No MCP tokens yet.
              </Typography>
            )}

            {tokens.map((token) => (
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
            ))}
          </Stack>
        )}
      </Stack>
    </SettingsDialogSection>
  );
}
