"use client";

import { useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import GroupIcon from "@mui/icons-material/Group";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  InputAdornment,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import axios from "axios";

import { endpoints } from "@/components/endpoints";
import ButtonDialog from "@/components/ui/ButtonDialog";
import IconButtonTooltip from "@/components/ui/IconButtonTooltip";
import type { ExchangeAccountType } from "@/lib/exchange/types";

import type { ConfigDraft, ConfigDraftSetter } from "../settings-types";
import SettingsInfoField from "../Components/SettingsInfoField";
import { systemLog } from "@/lib/system/logging";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";

function maskCredentialValue(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function getExchangeAccountTypeLabel(
  type: ExchangeAccountType,
): string {
  return type === "binance" ? "Binance" : type;
}

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "account";
}

function CredentialSettingsField({
  info,
  label,
  onBlur,
  onChange,
  revealed,
  setRevealed,
  value,
}: {
  info: string;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
  value: string;
}) {
  const editable = revealed || value.length === 0;

  return (
    <TextField
      label={label}
      size="small"
      fullWidth
      value={editable ? value : maskCredentialValue(value)}
      onFocus={() => {
        if (!revealed && value.length === 0) {
          setRevealed(true);
        }
      }}
      onChange={(event) => {
        if (editable) {
          if (!revealed) {
            setRevealed(true);
          }
          onChange(event.target.value);
        }
      }}
      onBlur={onBlur}
      slotProps={{
        input: {
          readOnly: !editable,
          endAdornment: (
            <InputAdornment position="end">
              <IconButtonTooltip
                edge="end"
                size="small"
                onClick={() => setRevealed(!revealed)}
                tooltipTitle={revealed ? "Hide value" : "Show value"}
              >
                {revealed ? (
                  <VisibilityOffIcon fontSize="inherit" />
                ) : (
                  <VisibilityIcon fontSize="inherit" />
                )}
              </IconButtonTooltip>
              <IconButtonTooltip
                edge="end"
                size="small"
                sx={{ color: "text.secondary" }}
                tooltipTitle={info}
              >
                <HelpOutlineIcon fontSize="inherit" />
              </IconButtonTooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

interface ExchangeAccountManagerDialogProps {
  configDraft: ConfigDraft;
  selectedAccountSlug?: string;
  setConfigDraft: ConfigDraftSetter;
  setSelectedAccountSlug?: (slug: string) => void;
}

export default function ExchangeAccountManagerDialog({
  configDraft,
  selectedAccountSlug,
  setConfigDraft,
  setSelectedAccountSlug,
}: ExchangeAccountManagerDialogProps) {
  const selectedSlug =
    selectedAccountSlug ?? configDraft.accounts[0]?.slug;
  const [editingExchangeAccountSlug, setEditingExchangeAccountSlug] = useState(
    selectedSlug,
  );
  const [revealedCredentials, setRevealedCredentials] = useState({
    accountId: "",
    apiKey: false,
    apiSecret: false,
    passphrase: false,
  });
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const effectiveEditingAccountId = configDraft.accounts.some(
    (account) => account.slug === editingExchangeAccountSlug,
  )
    ? editingExchangeAccountSlug
    : (configDraft.accounts.find(
      (account) => account.slug === selectedSlug,
    )?.slug ?? configDraft.accounts[0]?.slug);
  const editingExchangeAccount =
    configDraft.accounts.find(
      (account) => account.slug === effectiveEditingAccountId,
    ) ?? configDraft.accounts[0];
  const currentRevealedCredentials =
    revealedCredentials.accountId === effectiveEditingAccountId
      ? revealedCredentials
      : {
        accountId: effectiveEditingAccountId,
        apiKey: false,
        apiSecret: false,
        passphrase: false,
      };

  const setCredentialRevealed = (
    key: "apiKey" | "apiSecret" | "passphrase",
    revealed: boolean,
  ) => {
    setRevealedCredentials((prev) => ({
      accountId: effectiveEditingAccountId,
      apiKey:
        prev.accountId === effectiveEditingAccountId ? prev.apiKey : false,
      apiSecret:
        prev.accountId === effectiveEditingAccountId ? prev.apiSecret : false,
      passphrase:
        prev.accountId === effectiveEditingAccountId ? prev.passphrase : false,
      [key]: revealed,
    }));
  };

  const persistExchangeAccounts = async (accounts: RuntimeAccountConfig[]) => {
    setSaveStatus("saving");
    try {
      const response = await axios.put<{
        accounts: RuntimeAccountConfig[];
      }>(endpoints.system.account.list, { accounts });
      const savedAccounts = Array.isArray(response.data?.accounts)
        ? response.data.accounts
        : accounts;
      setConfigDraft((prev) =>
        prev
          ? {
            ...prev,
            accounts: savedAccounts,
          }
          : prev,
      );
      if (
        selectedSlug &&
        !savedAccounts.some((account) => account.slug === selectedSlug)
      ) {
        setSelectedAccountSlug?.(savedAccounts[0]?.slug ?? "");
      }
      setEditingExchangeAccountSlug((current) =>
        savedAccounts.some((account) => account.slug === current)
          ? current
          : (savedAccounts.at(-1)?.slug ?? savedAccounts[0]?.slug ?? ""),
      );
      setSaveStatus("saved");
    } catch (error) {
      systemLog.error("Failed to save exchange accounts", error);
      setSaveStatus("error");
    }
  };

  const applyAccountDraftUpdate = (
    updater: (draft: ConfigDraft) => ConfigDraft,
    options: { persist?: boolean } = {},
  ) => {
    let nextDraft: ConfigDraft | null = null;
    setConfigDraft((prev) => {
      if (!prev) {
        return prev;
      }
      nextDraft = updater(prev);
      return nextDraft;
    });

    const draftToSave = nextDraft as ConfigDraft | null;
    if (!options.persist) {
      setSaveStatus("idle");
      return;
    }

    if (draftToSave) {
      void persistExchangeAccounts(draftToSave.accounts);
    }
  };

  const persistAccountDraft = () => {
    applyAccountDraftUpdate((draft) => draft, { persist: true });
  };

  const updateExchangeAccount = (
    accountId: string,
    updater: (account: RuntimeAccountConfig) => RuntimeAccountConfig,
  ) => {
    applyAccountDraftUpdate((prev) => {
      let selectedAccount: RuntimeAccountConfig | undefined;
      const exchangeAccounts = prev.accounts.map((account) => {
        if (account.slug !== accountId) {
          return account;
        }

        const nextAccount = updater(account);
        if (selectedSlug === accountId) {
          selectedAccount = nextAccount;
        }
        return nextAccount;
      });

      return {
        ...prev,
        accounts: exchangeAccounts,
        management: {
          ...prev.management,
          exchangeType: selectedAccount?.type ?? prev.management.exchangeType,
        },
      };
    });
  };

  const createExchangeAccountSlug = () => {
    const name = `Binance ${configDraft.accounts.length + 1}`;
    const base = slugFromName(name);
    const usedSlugs = new Set(
      configDraft.accounts.map((account) => account.slug),
    );
    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    return slug;
  };

  const addExchangeAccount = () => {
    const now = Date.now();
    const template =
      configDraft.accounts.find(
        (candidate) => candidate.slug === selectedSlug,
      ) ?? configDraft.accounts[0];
    if (!template) return;
    const account: RuntimeAccountConfig = {
      slug: createExchangeAccountSlug(),
      type: "binance",
      name: `Binance ${configDraft.accounts.length + 1}`,
      description: "",
      credentials: { apiKey: "", apiSecret: "" },
      enabled: true,
      trading: structuredClone(template.trading),
      sandbox: {
        initialBalanceUSDT: template.sandbox.initialBalanceUSDT,
      },
      createdAt: now,
      updatedAt: now,
    };

    applyAccountDraftUpdate(
      (prev) => ({
        ...prev,
        accounts: [...prev.accounts, account],
      }),
      { persist: true },
    );
    setEditingExchangeAccountSlug(account.slug);
  };

  const deleteEditingExchangeAccount = () => {
    if (!editingExchangeAccount || configDraft.accounts.length <= 1) {
      return;
    }

    const nextSelectedSlug =
      selectedSlug === editingExchangeAccount.slug
        ? configDraft.accounts.find(
          (account) => account.slug !== editingExchangeAccount.slug,
        )?.slug
        : selectedSlug;

    applyAccountDraftUpdate(
      (prev) => {
        const exchangeAccounts = prev.accounts.filter(
          (account) => account.slug !== editingExchangeAccount.slug,
        );
        const selectedAccount = exchangeAccounts.find(
          (account) => account.slug === nextSelectedSlug,
        );

        const nextDraft = {
          ...prev,
          accounts: exchangeAccounts,
          management: {
            ...prev.management,
            exchangeType:
              selectedAccount?.type ?? prev.management.exchangeType,
          },
        };
        return nextDraft;
      },
      { persist: true },
    );
    if (nextSelectedSlug && nextSelectedSlug !== selectedSlug) {
      setSelectedAccountSlug?.(nextSelectedSlug);
    }
    setEditingExchangeAccountSlug(
      configDraft.accounts.find(
        (account) => account.slug !== editingExchangeAccount.slug,
      )?.slug ?? "",
    );
  };

  return (
    <ButtonDialog
      maxWidth="md"
      size="small"
      title="Accounts"
      titleLong="Exchange Accounts"
      variant="outlined"
      customButton={(handleOpen) => (
        <IconButton
          aria-label="Manage exchange accounts"
          onClick={handleOpen}
          size="small"
          title="Manage exchange accounts"
          sx={{
            alignSelf: "stretch",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            height: 40,
            width: 40,
          }}
        >
          <GroupIcon fontSize="small" />
        </IconButton>
      )}
    >
      {() => (
        <Stack gap={2}>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>
                Saved Accounts
              </Typography>
              <Typography color="text.secondary" variant="caption">
                Choose a profile here only to edit its name, credentials, and
                entry status. Every enabled account runs independently.
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              {saveStatus !== "idle" && (
                <Typography
                  color={saveStatus === "error" ? "error" : "text.secondary"}
                  variant="caption"
                >
                  {saveStatus === "saving"
                    ? "Saving..."
                    : saveStatus === "saved"
                      ? "Saved"
                      : "Save failed"}
                </Typography>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={addExchangeAccount}
              >
                Add
              </Button>
              <Button
                color="error"
                disabled={configDraft.accounts.length <= 1}
                size="small"
                variant="outlined"
                startIcon={<DeleteOutlineIcon />}
                onClick={deleteEditingExchangeAccount}
              >
                Delete
              </Button>
            </Stack>
          </Box>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Stack gap={1}>
                {configDraft.accounts.map((account) => {
                  const selected = account.slug === editingExchangeAccount?.slug;
                  return (
                    <Button
                      key={account.slug}
                      variant={selected ? "contained" : "outlined"}
                      color={selected ? "primary" : "inherit"}
                      onClick={() => setEditingExchangeAccountSlug(account.slug)}
                      sx={{
                        justifyContent: "space-between",
                        minHeight: 44,
                        textAlign: "left",
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          component="span"
                          display="block"
                          fontWeight={700}
                          noWrap
                          variant="body2"
                        >
                          {account.name || account.slug}
                        </Typography>
                        <Typography
                          component="span"
                          display="block"
                          noWrap
                          sx={{
                            color: selected
                              ? "primary.contrastText"
                              : "text.secondary",
                          }}
                          variant="caption"
                        >
                          {getExchangeAccountTypeLabel(account.type)}
                        </Typography>
                        {account.description && (
                          <Typography
                            component="span"
                            display="block"
                            noWrap
                            sx={{
                              color: selected
                                ? "primary.contrastText"
                                : "text.secondary",
                              opacity: selected ? 0.82 : 1,
                            }}
                            variant="caption"
                          >
                            {account.description}
                          </Typography>
                        )}
                      </Box>
                      <Chip
                        color={account.enabled ? "success" : "default"}
                        label={account.enabled ? "Entries on" : "Entries off"}
                        size="small"
                        variant={selected ? "filled" : "outlined"}
                      />
                    </Button>
                  );
                })}
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, md: 8 }}>
              {editingExchangeAccount && (
                <Stack gap={1.5}>
                  <Grid container spacing={1.25}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <SettingsInfoField
                        label="Account Name"
                        size="small"
                        fullWidth
                        value={editingExchangeAccount.name}
                        onBlur={persistAccountDraft}
                        onChange={(event) =>
                          updateExchangeAccount(
                            editingExchangeAccount.slug,
                            (account) => ({
                              ...account,
                              name: event.target.value,
                              updatedAt: Date.now(),
                            }),
                          )
                        }
                        info="Label shown in the dashboard so you can recognize the exchange account."
                      />
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                      <SettingsInfoField
                        label="Account Type"
                        size="small"
                        fullWidth
                        value="Binance"
                        slotProps={{ input: { readOnly: true } }}
                        info="All SLOW accounts use the shared Binance exchange adapter."
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={editingExchangeAccount.enabled}
                            onChange={(event) => {
                              updateExchangeAccount(
                                editingExchangeAccount.slug,
                                (account) => ({
                                  ...account,
                                  enabled: event.target.checked,
                                  updatedAt: Date.now(),
                                }),
                              );
                            }}
                            onBlur={persistAccountDraft}
                          />
                        }
                        label="Enable new entries for this account"
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <SettingsInfoField
                        label="Description"
                        size="small"
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={4}
                        value={editingExchangeAccount.description}
                        onBlur={persistAccountDraft}
                        onChange={(event) =>
                          updateExchangeAccount(
                            editingExchangeAccount.slug,
                            (account) => ({
                              ...account,
                              description: event.target.value,
                              updatedAt: Date.now(),
                            }),
                          )
                        }
                        info="Optional notes about what this exchange account is for."
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <CredentialSettingsField
                        label={`${getExchangeAccountTypeLabel(
                          editingExchangeAccount.type,
                        )} API Key`}
                        value={editingExchangeAccount.credentials.apiKey}
                        revealed={currentRevealedCredentials.apiKey}
                        setRevealed={(revealed) =>
                          setCredentialRevealed("apiKey", revealed)
                        }
                        onBlur={persistAccountDraft}
                        onChange={(value) =>
                          updateExchangeAccount(
                            editingExchangeAccount.slug,
                            (account) => ({
                              ...account,
                              credentials: {
                                ...account.credentials,
                                apiKey: value,
                              },
                              updatedAt: Date.now(),
                            }),
                          )
                        }
                        info="Private API key used for this account's balance checks and live orders."
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <CredentialSettingsField
                        label={`${getExchangeAccountTypeLabel(
                          editingExchangeAccount.type,
                        )} API Secret`}
                        value={editingExchangeAccount.credentials.apiSecret}
                        revealed={currentRevealedCredentials.apiSecret}
                        setRevealed={(revealed) =>
                          setCredentialRevealed("apiSecret", revealed)
                        }
                        onBlur={persistAccountDraft}
                        onChange={(value) =>
                          updateExchangeAccount(
                            editingExchangeAccount.slug,
                            (account) => ({
                              ...account,
                              credentials: {
                                ...account.credentials,
                                apiSecret: value,
                              },
                              updatedAt: Date.now(),
                            }),
                          )
                        }
                        info="Private API secret saved into the local SLOW config JSON."
                      />
                    </Grid>

                  </Grid>
                </Stack>
              )}
            </Grid>
          </Grid>
        </Stack>
      )}
    </ButtonDialog>
  );
}
