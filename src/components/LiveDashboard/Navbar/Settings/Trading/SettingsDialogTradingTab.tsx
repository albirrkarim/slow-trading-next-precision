"use client";

import type { SlowTradingAccountTradingConfig } from "@/lib/slowTrading";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Grid,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useState, type Dispatch, type SetStateAction } from "react";

import SettingsInfoField from "../Components/SettingsInfoField";
import type {
  ConfigDraft,
  ConfigDraftSetter,
  DashboardState,
} from "../settings-types";
import TradingAccountSettings from "./TradingAccountSettings";
import TradingConfigJsonEditor from "./TradingConfigJsonEditor";
import TradingSettingsPreview from "./TradingSettingsPreview";

interface SettingsDialogTradingTabProps {
  configDraft: ConfigDraft;
  dashboardState?: DashboardState;
  setConfigDraft: ConfigDraftSetter;
}

export default function SettingsDialogTradingTab({
  configDraft,
  dashboardState,
  setConfigDraft,
}: SettingsDialogTradingTabProps) {
  const [editorMode, setEditorMode] = useState<"json" | "ui">("ui");
  const selectedAccount = configDraft.accounts.find(
    (account) => account.slug === configDraft.runtime.exchangeAccountSlug,
  );
  const setSelectedAccountTrading: Dispatch<
    SetStateAction<SlowTradingAccountTradingConfig>
  > = (value) => {
    setConfigDraft((current) => {
      if (!current) return current;
      const accountSlug = current.runtime.exchangeAccountSlug;
      return {
        ...current,
        accounts: current.accounts.map((account) =>
          account.slug === accountSlug
            ? {
                ...account,
                trading:
                  typeof value === "function"
                    ? value(account.trading)
                    : value,
                updatedAt: Date.now(),
              }
            : account,
        ),
      };
    });
  };

  const applySelectedAccountTradingConfig = (
    trading: SlowTradingAccountTradingConfig,
  ) => {
    setConfigDraft((current) => {
      if (!current) return current;

      const account = current.accounts.find(
        (candidate) => candidate.slug === current.runtime.exchangeAccountSlug,
      );
      if (!account) return current;

      const nextAccount = {
        ...account,
        trading: structuredClone(trading),
        updatedAt: Date.now(),
      };
      const nextDraft = {
        ...current,
        accounts: current.accounts.map((candidate) =>
          candidate.slug === account.slug ? nextAccount : candidate,
        ),
      };
      return nextDraft;
    });
  };

  return (
    <Grid alignItems="flex-start" container spacing={3}>
      <Grid size={{ xs: 12, sm: 12, md: 6, lg: 6 }}>
        <Stack gap={3} sx={{ minWidth: 0 }}>
          <Stack
            alignItems={{ xs: "stretch", sm: "center" }}
            direction={{ xs: "column", sm: "row" }}
            gap={1.5}
            justifyContent="space-between"
          >
            <ToggleButtonGroup
              aria-label="Trading configuration editor mode"
              exclusive
              onChange={(_event, mode: "json" | "ui" | null) => {
                if (mode) setEditorMode(mode);
              }}
              size="small"
              sx={{
                alignSelf: { xs: "stretch", sm: "center" },
                "& .MuiToggleButton-root": {
                  gap: 0.75,
                  minHeight: 44,
                  px: 2,
                },
              }}
              value={editorMode}
            >
              <ToggleButton
                aria-label="Edit Trading configuration with UI"
                value="ui"
              >
                <TuneRoundedIcon aria-hidden fontSize="small" />
                UI
              </ToggleButton>
              <ToggleButton
                aria-label="Edit Trading configuration as JSON"
                disabled={!selectedAccount}
                value="json"
              >
                <CodeRoundedIcon aria-hidden fontSize="small" />
                JSON
              </ToggleButton>
            </ToggleButtonGroup>

            {configDraft.accounts.length > 0 && (
              <SettingsInfoField
                info="Chooses which account's Trading configuration is shown in this editor. It does not control which accounts execute."
                label="Editing Account"
                onChange={(event) => {
                  const account = configDraft.accounts.find(
                    (candidate) => candidate.slug === event.target.value,
                  );
                  setConfigDraft((current) =>
                    current && account
                      ? {
                          ...current,
                          runtime: {
                            ...current.runtime,
                            exchangeAccountSlug: account.slug,
                          },
                        }
                      : current,
                  );
                }}
                select
                size="small"
                sx={{ width: { xs: "100%", sm: 240 } }}
                value={configDraft.runtime.exchangeAccountSlug}
              >
                {configDraft.accounts.map((account) => (
                  <MenuItem key={account.slug} value={account.slug}>
                    {account.name}
                  </MenuItem>
                ))}
              </SettingsInfoField>
            )}
          </Stack>

          {editorMode === "json" && selectedAccount ? (
            <TradingConfigJsonEditor
              key={selectedAccount.slug}
              accountName={selectedAccount.name}
              onApply={applySelectedAccountTradingConfig}
              tradingConfig={selectedAccount.trading}
            />
          ) : selectedAccount ? (
            <TradingAccountSettings
              tradingConfig={selectedAccount.trading}
              dashboardState={dashboardState}
              setTradingConfig={setSelectedAccountTrading}
            />
          ) : null}
        </Stack>
      </Grid>

      <Grid size={{ xs: 12, sm: 12, md: 6, lg: 6 }}>
        {dashboardState && (
          <TradingSettingsPreview
            configDraft={configDraft}
            dashboardState={dashboardState}
          />
        )}
      </Grid>
    </Grid>
  );
}
