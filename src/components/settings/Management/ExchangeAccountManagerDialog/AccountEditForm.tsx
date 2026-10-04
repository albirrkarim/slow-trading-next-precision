"use client";

import {
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  Typography,
} from "@mui/material";
import type { UnifiedFuturesPositionMode } from "@/lib/exchange/types";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";
import SettingsInfoField from "../../Components/SettingsInfoField";

import { CredentialSettingsField } from "./CredentialSettingsField";
import {
  FUTURES_POSITION_MODE_OPTIONS,
  getExchangeAccountTypeLabel,
} from "./utils";

export interface RevealedCredentials {
  accountId: string;
  apiKey: boolean;
  apiSecret: boolean;
  passphrase: boolean;
}

export function AccountEditForm({
  account,
  hideCredentials,
  pairModeMissingHedge,
  revealedCredentials,
  setCredentialRevealed,
  updateExchangeAccount,
}: {
  account: RuntimeAccountConfig;
  hideCredentials?: boolean;
  pairModeMissingHedge: boolean;
  revealedCredentials: RevealedCredentials;
  setCredentialRevealed: (
    key: "apiKey" | "apiSecret" | "passphrase",
    revealed: boolean,
  ) => void;
  updateExchangeAccount: (
    accountId: string,
    updater: (account: RuntimeAccountConfig) => RuntimeAccountConfig,
  ) => void;
}) {
  return (
    <Grid container spacing={1.25}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SettingsInfoField
          label="Account Name"
          size="small"
          fullWidth
          value={account.name}
          onChange={(event) =>
            updateExchangeAccount(
              account.slug,
              (current) => ({
                ...current,
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
          info="All PRECISION accounts use the shared Binance exchange adapter."
        />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <SettingsInfoField
          label="Futures Position Mode"
          select
          size="small"
          fullWidth
          value={
            account.futuresPositionMode ??
            "ONE_WAY"
          }
          onChange={(event) =>
            updateExchangeAccount(
              account.slug,
              (current) => ({
                ...current,
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
          info="Binance futures position mode of this exchange account. Pair strategies (both / streak with entryLegs BOTH) require Hedge. PRECISION never changes it on the exchange — switch it in Binance first, then match it here; live trading verifies it against Binance before every pair entry."
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
              checked={account.enabled}
              onChange={(event) => {
                updateExchangeAccount(
                  account.slug,
                  (current) => ({
                    ...current,
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
          value={account.description}
          onChange={(event) =>
            updateExchangeAccount(
              account.slug,
              (current) => ({
                ...current,
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
            account.type,
          )} API Key`}
          value={account.credentials.apiKey}
          revealed={revealedCredentials.apiKey}
          setRevealed={(revealed) =>
            setCredentialRevealed("apiKey", revealed)
          }
          onChange={(value) =>
            updateExchangeAccount(
              account.slug,
              (current) => ({
                ...current,
                credentials: {
                  ...current.credentials,
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
            account.type,
          )} API Secret`}
          value={account.credentials.apiSecret}
          revealed={revealedCredentials.apiSecret}
          setRevealed={(revealed) =>
            setCredentialRevealed("apiSecret", revealed)
          }
          onChange={(value) =>
            updateExchangeAccount(
              account.slug,
              (current) => ({
                ...current,
                credentials: {
                  ...current.credentials,
                  apiSecret: value,
                },
                updatedAt: Date.now(),
              }),
            )
          }
          info="Private API secret saved into the local PRECISION config JSON."
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
  );
}
