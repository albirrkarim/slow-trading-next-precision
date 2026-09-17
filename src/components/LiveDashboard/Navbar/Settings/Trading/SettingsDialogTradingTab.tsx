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
import { useState } from "react";

import SettingsInfoField from "../Components/SettingsInfoField";
import {
  applyAccountProfileToConfigDraft,
  updateAccountSettingsInConfigDraft,
} from "../helpers";
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
  const selectedAccount = configDraft.exchangeAccounts.find(
    (account) => account.slug === configDraft.exchangeAccountSlug,
  );
  const setSelectedAccountDraft: ConfigDraftSetter = (value) => {
    setConfigDraft((current) => {
      if (!current || current.exchangeAccounts.length === 0) {
        return typeof value === "function" ? value(current) : value;
      }

      return updateAccountSettingsInConfigDraft(
        current,
        current.exchangeAccountSlug,
        (currentAccountDraft) => {
          const next =
            typeof value === "function" ? value(currentAccountDraft) : value;
          return next ?? currentAccountDraft;
        },
      );
    });
  };

  const applySelectedAccountTradingConfig = (
    trading: SlowTradingAccountTradingConfig,
  ) => {
    setConfigDraft((current) => {
      if (!current) return current;

      const account = current.exchangeAccounts.find(
        (candidate) => candidate.slug === current.exchangeAccountSlug,
      );
      if (!account) return current;

      const nextAccount = {
        ...account,
        trading: structuredClone(trading),
        updatedAt: Date.now(),
      };
      const nextDraft = {
        ...current,
        exchangeAccounts: current.exchangeAccounts.map((candidate) =>
          candidate.slug === account.slug ? nextAccount : candidate,
        ),
      };

      return applyAccountProfileToConfigDraft(nextDraft, nextAccount);
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

            {configDraft.exchangeAccounts.length > 0 && (
              <SettingsInfoField
                info="Chooses which account's Trading configuration is shown in this editor. It does not control which accounts execute."
                label="Editing Account"
                onChange={(event) => {
                  const account = configDraft.exchangeAccounts.find(
                    (candidate) => candidate.slug === event.target.value,
                  );
                  setConfigDraft((current) =>
                    current && account
                      ? applyAccountProfileToConfigDraft(current, account)
                      : current,
                  );
                }}
                select
                size="small"
                sx={{ width: { xs: "100%", sm: 240 } }}
                value={configDraft.exchangeAccountSlug}
              >
                {configDraft.exchangeAccounts.map((account) => (
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
          ) : (
            <TradingAccountSettings
              configDraft={configDraft}
              dashboardState={dashboardState}
              setConfigDraft={setSelectedAccountDraft}
            />
          )}
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
