"use client";

import { useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import GroupIcon from "@mui/icons-material/Group";
import {
  Box,
  Button,
  Grid,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import pair from "@/lib/strategies/shared/pair";
import type { ConfigDraft, ConfigDraftSetter } from "../../settings-types";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";

import { AccountEditForm } from "./AccountEditForm";
import { AccountList } from "./AccountList";
import { slugFromName } from "./utils";

export { getExchangeAccountTypeLabel } from "./utils";

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
              <AccountList
                accounts={configDraft.accounts}
                editingSlug={editingExchangeAccount?.slug}
                onSelect={setEditingExchangeAccountSlug}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 8 }}>
              {editingExchangeAccount && (
                <Stack gap={1.5}>
                  <AccountEditForm
                    account={editingExchangeAccount}
                    hideCredentials={hideCredentials}
                    pairModeMissingHedge={pairModeMissingHedge}
                    revealedCredentials={currentRevealedCredentials}
                    setCredentialRevealed={setCredentialRevealed}
                    updateExchangeAccount={updateExchangeAccount}
                  />
                </Stack>
              )}
            </Grid>
          </Grid>
        </Stack>
      )}
    </ButtonDialog>
  );
}
