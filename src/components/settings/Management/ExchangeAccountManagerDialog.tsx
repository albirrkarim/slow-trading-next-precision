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
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import IconButtonTooltip from "@/components/ui/IconButtonTooltip";
import pair from "@/lib/strategies/shared/pair";
import type {
  ExchangeAccountType,
  UnifiedFuturesPositionMode,
} from "@/lib/exchange/types";

import type { ConfigDraft, ConfigDraftSetter } from "../settings-types";
import SettingsInfoField from "../Components/SettingsInfoField";
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

const FUTURES_POSITION_MODE_OPTIONS = [
  { label: "One-way", value: "ONE_WAY" },
  { label: "Hedge", value: "HEDGE" },
] satisfies {
  label: string;
  value: NonNullable<RuntimeAccountConfig["futuresPositionMode"]>;
}[];

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
  onBlur?: () => void;
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
  /**
   * Hides the API credential fields — used by contexts (backtest settings)
   * whose drafts must never carry exchange keys.
   */
  hideCredentials?: boolean;
  selectedAccountSlug?: string;
  setConfigDraft: ConfigDraftSetter;
  setSelectedAccountSlug?: (slug: string) => void;
}

export default function ExchangeAccountManagerDialog({
  configDraft,
  hideCredentials,
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

  const effectiveEditingAccountId = configDraft.accounts.some(
    (account) => account.slug === editingExchangeAccountSlug,
  )
    ? editingExchangeAccountSlug
    : (configDraft.accounts.find(
      (account) => account.slug === selectedSlug,
    )?.slug ?? configDraft.accounts[0]?.slug);
  const editingExchangeAccountRaw =
    configDraft.accounts.find(
      (account) => account.slug === effectiveEditingAccountId,
    ) ?? configDraft.accounts[0];
  // Drafts restored from stripped configs can carry no credentials object.
  const editingExchangeAccount = editingExchangeAccountRaw
    ? {
        ...editingExchangeAccountRaw,
        credentials: {
          apiKey: "",
          apiSecret: "",
          ...((editingExchangeAccountRaw.credentials ?? {}) as Partial<
            RuntimeAccountConfig["credentials"]
          >),
        },
      }
    : editingExchangeAccountRaw;
  const pairModeMissingHedge =
    pair.isPairMode({
      entryLegs: editingExchangeAccount?.trading.entryLegs,
      strategy: configDraft.management.strategy,
    }) &&
    Boolean(editingExchangeAccount?.enabled) &&
    editingExchangeAccount?.futuresPositionMode !== "HEDGE";
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

  // Account edits stay draft-only: production persists them through the
  // settings Save button, and the backtest settings draft never touches the
  // live accounts endpoint or the config-change log.
  const applyAccountDraftUpdate = (
    updater: (draft: ConfigDraft) => ConfigDraft,
  ) => {
    setConfigDraft((prev) => (prev ? updater(prev) : prev));
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
      futuresPositionMode: "ONE_WAY",
      trading: structuredClone(template.trading),
      sandbox: {
        initialBalanceUSDT: template.sandbox.initialBalanceUSDT,
      },
      createdAt: now,
      updatedAt: now,
    };

    applyAccountDraftUpdate((prev) => ({
      ...prev,
      accounts: [...prev.accounts, account],
    }));
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

    applyAccountDraftUpdate((prev) => {
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
    });
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
                Choose a profile here only to edit its name, credentials,
                position mode, and entry status. Edits update the settings
                draft — on the dashboard they persist when you press Save.
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
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
                          {` · ${account.futuresPositionMode === "HEDGE" ? "Hedge" : "One-way"}`}
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

                    <Grid size={{ xs: 12, md: 6 }}>
                      <SettingsInfoField
                        label="Futures Position Mode"
                        select
                        size="small"
                        fullWidth
                        value={
                          editingExchangeAccount.futuresPositionMode ??
                          "ONE_WAY"
                        }
                        onChange={(event) =>
                          updateExchangeAccount(
                            editingExchangeAccount.slug,
                            (account) => ({
                              ...account,
                              futuresPositionMode: event.target
                                .value as UnifiedFuturesPositionMode,
                              updatedAt: Date.now(),
                            }),
                          )
                        }
                        error={pairModeMissingHedge}
                        helperText={
                          pairModeMissingHedge
                            ? "Pair strategy needs Hedge mode — the runtime refuses to start while this account is enabled."
                            : undefined
                        }
                        info="Binance futures position mode of this exchange account. Pair strategies (both / streak with entryLegs BOTH) require Hedge. SLOW never changes it on the exchange — switch it in Binance first, then match it here; live trading verifies it against Binance before every pair entry."
                      >
                        {FUTURES_POSITION_MODE_OPTIONS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </SettingsInfoField>
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

                    {!hideCredentials && (
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
                    )}

                    {!hideCredentials && (
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
                    )}

                    {hideCredentials && (
                      <Grid size={{ xs: 12 }}>
                        <Typography color="text.secondary" variant="caption">
                          Exchange credentials are managed on the live dashboard
                          — backtest configs never store API keys.
                        </Typography>
                      </Grid>
                    )}

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
