"use client";

import { useState } from "react";

import ButtonDialog from "@/components/ui/ButtonDialog";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AutoGraphIcon from "@mui/icons-material/AutoGraph";
import BackupIcon from "@mui/icons-material/Backup";
import HubIcon from "@mui/icons-material/Hub";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import SettingsIcon from "@mui/icons-material/Settings";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tab,
  Tabs,
} from "@mui/material";
import SettingsDialogRuntimeTab from "./Runtime/SettingsDialogRuntimeTab";
import SettingsDialogBackupTab from "./Backup/SettingsDialogBackupTab";
import SettingsDialogBlackSwanTab from "./Backswan/SettingsDialogBlackSwanTab";
import SettingsDialogManagementTab from "./Management/SettingsDialogManagementTab";
import SettingsDialogMcpTab from "./MCP/SettingsDialogMcpTab";
import SettingsDialogNotificationTab from "./Notification/SettingsDialogNotificationTab";
import SettingsDialogTradingTab from "./Trading/SettingsDialogTradingTab";
import SettingsDialogWithdrawTab from "./Withdrawal/SettingsDialogWithdrawTab";
import type { ConfigDraft, ConfigDraftSetter, DashboardState } from "./settings-types";

export const SETTINGS_TABS = [
  { label: "Trading", value: "trading" },
  { label: "Management", value: "management" },
  { label: "Black Swan", value: "black-swan" },
  { label: "Runtime", value: "runtime" },
  { label: "Backup", value: "backup" },
  { label: "Notification", value: "notification" },
  { label: "Withdraw", value: "withdraw" },
  { label: "MCP", value: "mcp" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "trading";

function SettingsTabIcon({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "trading":
      return <AutoGraphIcon fontSize="small" />;
    case "management":
      return <ManageAccountsIcon fontSize="small" />;
    case "black-swan":
      return <ShieldOutlinedIcon fontSize="small" />;
    case "runtime":
      return <TuneIcon fontSize="small" />;
    case "backup":
      return <BackupIcon fontSize="small" />;
    case "notification":
      return <NotificationsActiveIcon fontSize="small" />;
    case "withdraw":
      return <AccountBalanceWalletIcon fontSize="small" />;
    case "mcp":
      return <HubIcon fontSize="small" />;
    default:
      return null;
  }
}

export default function SettingsDialog(props: {
  configDraft: ConfigDraft;
  setConfigDraft: ConfigDraftSetter;

  dashboardState?: DashboardState;
  hiddenTabs?: readonly SettingsTab[];
  onCloseDialog?: () => void;
  onOpenDialog?: () => void;
  onReinitialize?: () => Promise<void>;
  reinitializing?: boolean;
  onResetToProduction?: () => Promise<void> | void;
  resetSandbox?: (accountSlug: string) => Promise<void>;
  resettingSandboxAccount?: string | null;
  safeHavenUSDT?: number;
  saveConfig?: (handleClose?: () => void) => Promise<void>;
  pushLocalStorageToOnline?: (onlineBaseUrl: string) => Promise<void>;
  pushingOnlineStorage?: boolean;
  savingConfig?: boolean;
  selectedAccountSlug?: string;
  setSafeHavenUSDT?: (value: number) => void;
  setSelectedAccountSlug?: (slug: string) => void;
  syncOnlineStorageToLocal?: (onlineBaseUrl: string) => Promise<void>;
  syncingOnlineStorage?: boolean;
  tryWithdrawNow?: (scheduleId: string) => Promise<void>;
  tryingWithdraw?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(DEFAULT_SETTINGS_TAB);
  const [resettingToProduction, setResettingToProduction] = useState(false);
  const {
    configDraft,
    setConfigDraft,
    dashboardState,
    hiddenTabs = [],
    onCloseDialog,
    onOpenDialog,
    onReinitialize,
    onResetToProduction,
    pushLocalStorageToOnline,
    pushingOnlineStorage,
    reinitializing,
    resetSandbox,
    resettingSandboxAccount,
    safeHavenUSDT = 0,
    saveConfig,
    savingConfig,
    selectedAccountSlug,
    setSafeHavenUSDT = () => undefined,
    setSelectedAccountSlug,
    syncOnlineStorageToLocal,
    syncingOnlineStorage,
    tryWithdrawNow,
    tryingWithdraw,
  } = props;

  return (
    <ButtonDialog
      title="Settings"
      titleLong="Dashboard Settings"
      maxWidth="xl"
      customButton={(handleOpen) => (
        <IconButton
          onClick={() => {
            onOpenDialog?.();
            handleOpen();
          }}
          title="Open dashboard settings"
          color="inherit"
        >
          <SettingsIcon />
        </IconButton>
      )}
      beforeClose={onCloseDialog}
    >
      {(handleClose) => (
        <Box sx={{ p: 1 }}>
          <Box
            sx={{
              alignItems: "flex-start",
              display: "flex",
              gap: 1.5,
              mb: 1.5,
              flexDirection: { xs: "column", md: "row" },
            }}
          >
            <Tabs
              value={activeTab}
              onChange={(_, value: SettingsTab) => {
                setActiveTab(value);
              }}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                flex: 1,
                maxWidth: "100%",
                minHeight: 34,
                "& .MuiTabs-indicator": {
                  height: 2,
                },
                "& .MuiTab-root": {
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  minHeight: 34,
                  minWidth: 0,
                  px: 1.25,
                  py: 0.5,
                },
                "& .MuiTab-iconWrapper": {
                  fontSize: "1rem",
                  mr: 0.75,
                },
              }}
            >
              {SETTINGS_TABS.filter(
                (tab) => !hiddenTabs.includes(tab.value),
              ).map((tab) => (
                <Tab
                  icon={<SettingsTabIcon tab={tab.value} />}
                  iconPosition="start"
                  key={tab.value}
                  label={tab.label}
                  value={tab.value}
                />
              ))}
            </Tabs>

            {onResetToProduction && (
              <Button
                color="inherit"
                disabled={resettingToProduction}
                onClick={() => {
                  setResettingToProduction(true);
                  void Promise.resolve(onResetToProduction()).finally(() =>
                    setResettingToProduction(false),
                  );
                }}
                size="small"
                startIcon={
                  resettingToProduction ? (
                    <CircularProgress color="inherit" size={14} />
                  ) : (
                    <RestartAltIcon fontSize="small" />
                  )
                }
                sx={{
                  alignSelf: "center",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                Reset to Production
              </Button>
            )}
          </Box>

          <Box sx={{ minHeight: 420 }}>
            {activeTab === "trading" ? (
              <SettingsDialogTradingTab
                configDraft={configDraft}
                dashboardState={dashboardState}
                selectedAccountSlug={selectedAccountSlug}
                setConfigDraft={setConfigDraft}
                setSelectedAccountSlug={setSelectedAccountSlug}
              />
            ) : null}

            {activeTab === "runtime" ? (
              <SettingsDialogRuntimeTab
                configDraft={configDraft}
                selectedAccountSlug={selectedAccountSlug}
                setConfigDraft={setConfigDraft}

                onReinitialize={onReinitialize}
                pushLocalStorageToOnline={pushLocalStorageToOnline}
                pushingOnlineStorage={pushingOnlineStorage}
                reinitializing={reinitializing}
                resetSandbox={resetSandbox}
                resettingSandboxAccount={resettingSandboxAccount}
                syncOnlineStorageToLocal={syncOnlineStorageToLocal}
                syncingOnlineStorage={syncingOnlineStorage}
              />
            ) : null}

            {activeTab === "management" ? (
              <SettingsDialogManagementTab
                configDraft={configDraft}
                selectedAccountSlug={selectedAccountSlug}
                setConfigDraft={setConfigDraft}
                setSelectedAccountSlug={setSelectedAccountSlug}
              />
            ) : null}

            {(activeTab === "black-swan" && dashboardState) ? (
              <SettingsDialogBlackSwanTab
                configDraft={configDraft}
                dashboardState={dashboardState}
                selectedAccountSlug={selectedAccountSlug}
                setConfigDraft={setConfigDraft}
              />
            ) : null}

            {activeTab === "backup" ? (
              <SettingsDialogBackupTab
                configDraft={configDraft}
                setConfigDraft={setConfigDraft}
              />
            ) : null}

            {activeTab === "notification" ? (
              <SettingsDialogNotificationTab
                configDraft={configDraft}
                setConfigDraft={setConfigDraft}
              />
            ) : null}

            {(activeTab === "withdraw" && tryWithdrawNow && tryingWithdraw != undefined) ? (
              <SettingsDialogWithdrawTab
                configDraft={configDraft}
                safeHavenUSDT={safeHavenUSDT}
                setSafeHavenUSDT={setSafeHavenUSDT}
                setConfigDraft={setConfigDraft}
                tryWithdrawNow={tryWithdrawNow}
                tryingWithdraw={tryingWithdraw}
              />
            ) : null}

            {activeTab === "mcp" && <SettingsDialogMcpTab />}
          </Box>

          {saveConfig && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 2,
              }}
            >
              <Button onClick={handleClose}>Close</Button>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={() => {
                  void saveConfig(handleClose);
                }}
                disabled={savingConfig}
              >
                {savingConfig ? "Saving..." : "Save"}
              </Button>
            </Box>
          )}
        </Box>
      )}
    </ButtonDialog>
  );
}
