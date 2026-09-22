"use client";

import { useState } from "react";

import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import RefreshIcon from "@mui/icons-material/Refresh";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Box,
  Button,
  CircularProgress,
  Grid,
  Stack,
  Switch,
  Typography,
} from "@mui/material";

import SettingsInfoField from "../Components/SettingsInfoField";
import SettingsDialogSection from "../Components/SettingsDialogSection";
import RuntimeMonitoringSettings from "./RuntimeMonitoringSettings";
import type { ConfigDraft, ConfigDraftSetter } from "../settings-types";

const DEFAULT_SYNC_ONLINE_BASE_URL = "https://wealth.reinventwp.com";

interface SettingsDialogRuntimeTabProps {
  configDraft: ConfigDraft;
  setConfigDraft: ConfigDraftSetter;

  onReinitialize?: () => Promise<void>;
  pushLocalStorageToOnline?: (onlineBaseUrl: string) => Promise<void>;
  pushingOnlineStorage?: boolean;
  reinitializing?: boolean;
  resetSandbox?: (accountSlug: string) => Promise<void>;
  resettingSandboxAccount?: string | null;
  selectedAccountSlug?: string;
  syncOnlineStorageToLocal?: (onlineBaseUrl: string) => Promise<void>;
  syncingOnlineStorage?: boolean;
}

function RuntimeToggle(props: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const { checked, description, label, onChange } = props;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Switch
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          color="default"
          size="small"
        />
        <Typography variant="body2" fontWeight="bold">
          {label}: {checked ? "ON" : "OFF"}
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", ml: 6, mt: -0.5 }}
      >
        {description}
      </Typography>
    </Box>
  );
}

export default function SettingsDialogRuntimeTab({
  configDraft,
  onReinitialize,
  pushLocalStorageToOnline,
  pushingOnlineStorage,
  reinitializing,
  resetSandbox,
  resettingSandboxAccount,
  selectedAccountSlug,
  setConfigDraft,
  syncOnlineStorageToLocal,
  syncingOnlineStorage,
}: SettingsDialogRuntimeTabProps) {
  const [syncOnlineBaseUrl, setSyncOnlineBaseUrl] = useState(
    DEFAULT_SYNC_ONLINE_BASE_URL,
  );
  const updateRuntime = (patch: Partial<ConfigDraft["runtime"]>) =>
    setConfigDraft((prev) =>
      prev ? { ...prev, runtime: { ...prev.runtime, ...patch } } : prev,
    );

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SettingsDialogSection
          title="Automation"
          description="Controls whether the slow engine loops on its own and whether entries and exits can happen automatically."
        >
          <Stack spacing={2}>
            <RuntimeToggle
              checked={configDraft.runtime.runnerEnabled}
              label="Runner"
              description="When ON, the background scheduler keeps scanning and executing on its normal cadence."
              onChange={(checked) =>
                updateRuntime({ runnerEnabled: checked })
              }
            />

            <RuntimeToggle
              checked={configDraft.runtime.autoEntryEnabled}
              label="Auto Entry"
              description="When ON, qualifying signals can open positions without manual intervention."
              onChange={(checked) =>
                updateRuntime({ autoEntryEnabled: checked })
              }
            />

            <SettingsInfoField
              label="Daily PnL Auto-Entry Stop (USDT)"
              type="number"
              size="small"
              fullWidth
              value={configDraft.runtime.autoEntryDailyPnlLimitUSDT ?? -50}
              onChange={(event) =>
                updateRuntime({
                  autoEntryDailyPnlLimitUSDT: Math.min(
                    0,
                    Number(event.target.value),
                  ),
                })
              }
              slotProps={{
                htmlInput: {
                  max: 0,
                  step: "1",
                },
              }}
              info="Pauses automatic entries when the current UTC-day USD PnL shown in the navbar is at or below this value. Wins and losses are netted; this is not accumulated losses. Exits and manual entries remain available."
            />

            <RuntimeToggle
              checked={configDraft.runtime.autoExitEnabled}
              label="Auto Exit"
              description="When ON, TP and SL management can close positions automatically."
              onChange={(checked) =>
                updateRuntime({ autoExitEnabled: checked })
              }
            />

            <RuntimeToggle
              checked={configDraft.runtime.entrySignalBypass}
              label="Entry Signal Bypass"
              description="When ON, the normal signal gate is relaxed for automatic entries. Manual entry already overrides the normal verification path."
              onChange={(checked) =>
                updateRuntime({ entrySignalBypass: checked })
              }
            />
          </Stack>
        </SettingsDialogSection>

        <SettingsDialogSection
          title="Monitoring"
          description="Controls the independent production stage cadences and the time bucket used to retain each open position's PnL history."
        >
          <RuntimeMonitoringSettings
            configDraft={configDraft}
            selectedAccountSlug={selectedAccountSlug}
            setConfigDraft={setConfigDraft}
          />
        </SettingsDialogSection>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <SettingsDialogSection
          title="Sandbox Mode"
          description="Execution mode applies globally. Each account keeps its own sandbox starting balance and reset action."
        >
          <Stack spacing={2}>
            <RuntimeToggle
              checked={configDraft.runtime.sandboxEnabled}
              label="Sandbox Mode"
              description="When ON, every enabled account simulates orders locally and sends no live exchange orders."
              onChange={(checked) => updateRuntime({ sandboxEnabled: checked })}
            />

            {configDraft.accounts.map((account) => {
              const resetting = resettingSandboxAccount === account.slug;
              return (
                <Box
                  key={account.slug}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1.5,
                    p: 2,
                  }}
                >
                  <Stack spacing={2}>
                    <Box>
                      <Typography fontWeight={700} variant="subtitle2">
                        {account.name}
                      </Typography>
                      <Typography color="text.secondary" variant="caption">
                        {account.slug}
                      </Typography>
                    </Box>

                      <SettingsInfoField
                        label={`${account.name} Sandbox Initial Balance (USDT)`}
                        type="number"
                        size="small"
                        fullWidth
                        value={account.sandbox.initialBalanceUSDT}
                        onChange={(event) =>
                          setConfigDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  accounts: prev.accounts.map((candidate) =>
                                    candidate.slug === account.slug
                                      ? {
                                          ...candidate,
                                          sandbox: {
                                            ...candidate.sandbox,
                                            initialBalanceUSDT:
                                              parseFloat(event.target.value),
                                          },
                                        }
                                      : candidate,
                                  ),
                                }
                              : prev,
                          )
                        }
                        info="Used when this account's sandbox state is initialized or reset."
                      />

                      {resetSandbox && (
                        <Box>
                          <Button
                            color="warning"
                            variant="outlined"
                            startIcon={<RestartAltIcon />}
                            onClick={() => {
                              void resetSandbox(account.slug);
                            }}
                            disabled={
                              resettingSandboxAccount !== null ||
                              !configDraft.runtime.sandboxEnabled
                            }
                          >
                            {resetting
                              ? "Resetting..."
                              : `Reset ${account.name} Sandbox`}
                          </Button>

                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 1 }}
                          >
                            Rebuilds only this account&apos;s sandbox positions
                            and balance. Its live state and every other account
                            are not touched.
                          </Typography>
                        </Box>
                      )}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </SettingsDialogSection>

        {onReinitialize && (
          <SettingsDialogSection
            title="Dashboard Data"
            description="Rebuilds dashboard-derived cache data for the active exchange."
          >
            <Box>
              <Button
                color="warning"
                variant="outlined"
                startIcon={
                  reinitializing ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon />
                  )
                }
                onClick={() => {
                  void onReinitialize();
                }}
                disabled={reinitializing}
              >
                {reinitializing
                  ? "Reinitializing..."
                  : "Reinitialize Dashboard"}
              </Button>

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                Removes cached SLOW volatility files and the price-normalization
                map, then reloads storage, refreshes 24h volume and market cap
                snapshots, regenerates volatility data for configured coins,
                rebuilds price normalization, and refreshes the chart/table
                response. This is separate from normal dashboard fetching.
              </Typography>
            </Box>
          </SettingsDialogSection>
        )}

        {(syncOnlineStorageToLocal || pushLocalStorageToOnline) && (
          <SettingsDialogSection
            title="Debugging"
            description="Transfer persistent storage between this server and another dashboard server."
          >
            <Box>
              <SettingsInfoField
                label="Remote Server Base URL"
                size="small"
                fullWidth
                value={syncOnlineBaseUrl}
                onChange={(event) => {
                  setSyncOnlineBaseUrl(event.target.value);
                }}
                info="Dashboard URL to clone persistent storage from or push this server's storage to. Example: https://wealth.reinventwp.com"
                sx={{ mb: 1.5 }}
              />

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {syncOnlineStorageToLocal && (
                  <Button
                    color="warning"
                    variant="outlined"
                    startIcon={<CloudDownloadIcon />}
                    onClick={() => {
                      void syncOnlineStorageToLocal(syncOnlineBaseUrl);
                    }}
                    disabled={
                      syncingOnlineStorage ||
                      pushingOnlineStorage ||
                      !syncOnlineBaseUrl.trim()
                    }
                  >
                    {syncingOnlineStorage
                      ? "Syncing..."
                      : "Clone Storage to This Server"}
                  </Button>
                )}
                {pushLocalStorageToOnline && (
                  <Button
                    color="warning"
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    onClick={() => {
                      void pushLocalStorageToOnline(syncOnlineBaseUrl);
                    }}
                    disabled={
                      syncingOnlineStorage ||
                      pushingOnlineStorage ||
                      !syncOnlineBaseUrl.trim()
                    }
                  >
                    {pushingOnlineStorage
                      ? "Pushing..."
                      : "Push Storage to Remote Server"}
                  </Button>
                )}
              </Stack>

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                {`Clone fetches the full persistent storage export from ${syncOnlineBaseUrl.trim() || DEFAULT_SYNC_ONLINE_BASE_URL} and replaces this server's storage; push sends this server's storage the other way and replaces the remote server's storage. Each direction creates a timestamped backup on the server being replaced. If a dashboard is protected, configure the same SYNC_TOKEN on both servers.`}
              </Typography>
            </Box>
          </SettingsDialogSection>
        )}
      </Grid>
    </Grid>
  );
}
