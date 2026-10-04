"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HistoryIcon from "@mui/icons-material/History";
import {
  Box,
  IconButton,
  Typography,
} from "@mui/material";

import DailyPnlCalendarWrapper from "@/components/dashboard/positions/DailyPnlCalendarWrapper";
import ButtonDialog from "@/components/ui/ButtonDialog";
import ButtonLogout from "@/components/ui/ButtonLogout";
import DarkToggle from "@/components/ui/DarkToggle";

import UtcClock from "../UtcClock";
import Reporting from "@/components/reports";
import SettingsDialog from "@/components/settings/SettingsDialog";
import type {
  ConfigDraft,
  DashboardState,
  LiveDashboardNavbarProps,
} from "../navbar-types";

interface NavbarActionsSectionProps {
  configDraft: ConfigDraft | null;
  dashboardState: DashboardState | null;
  onRefresh: LiveDashboardNavbarProps["onRefresh"];
  onReinitialize: LiveDashboardNavbarProps["onReinitialize"];
  onSettingsDialogClose: () => void;
  onSettingsDialogOpen: () => void;
  reinitializing: boolean;
  resetSandbox: (accountSlug: string) => Promise<void>;
  resettingSandboxAccount: string | null;
  saveConfig: (handleClose?: () => void) => Promise<void>;
  savingConfig: boolean;
  pushLocalStorageToOnline: (onlineBaseUrl: string) => Promise<void>;
  pushingOnlineStorage: boolean;
  safeHavenUSDT: number;
  selectedAccountSlug?: string;
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft | null>>;
  setSafeHavenUSDT: (value: number) => void;
  setSelectedAccountSlug?: (slug: string) => void;
  syncOnlineStorageToLocal: (onlineBaseUrl: string) => Promise<void>;
  syncingOnlineStorage: boolean;
  tryWithdrawNow: (scheduleId: string) => Promise<void>;
  tryingWithdraw: boolean;
}

export function NavbarActionsSection({
  configDraft,
  dashboardState,
  onRefresh,
  onReinitialize,
  onSettingsDialogClose,
  onSettingsDialogOpen,
  reinitializing,
  resetSandbox,
  resettingSandboxAccount,
  pushLocalStorageToOnline,
  pushingOnlineStorage,
  saveConfig,
  savingConfig,
  safeHavenUSDT,
  selectedAccountSlug,
  setConfigDraft,
  setSafeHavenUSDT,
  setSelectedAccountSlug,
  syncOnlineStorageToLocal,
  syncingOnlineStorage,
  tryWithdrawNow,
  tryingWithdraw,
}: NavbarActionsSectionProps) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: { xs: 0.25, md: 1 },
        alignItems: "center",
        gridArea: "actions",
        justifyContent: { xs: "flex-start", md: "flex-end" },
        justifySelf: { xs: "stretch", md: "end" },
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      {dashboardState && configDraft ? (
        <>
          <ButtonDialog
            // PROD:FULLSCREEN_TRADE_HISTORY_REPORT
            forceFullscreen
            title="History"
            titleLong="Trade History"
            maxWidth="xl"
            useAppBar
            customButton={(handleOpen) => (
              <IconButton
                onClick={handleOpen}
                title="Open trading history report"
                color="inherit"
              >
                <HistoryIcon />
              </IconButton>
            )}
          >
            {() =>
              dashboardState ? (
                <Reporting
                  dashboardState={dashboardState}
                  onRefresh={onRefresh}
                />
              ) : (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Dashboard state is not loaded yet.
                  </Typography>
                </Box>
              )
            }
          </ButtonDialog>

          <ButtonDialog
            title="Daily PnL Calendar"
            maxWidth={false}
            contentSx={{ p: { xs: 0, sm: 1 } }}
            sx={{
              width: "100%",
              maxWidth: "100%",
            }}
            size="small"
            color="inherit"
            customButton={(handleOpen) => (
              <IconButton
                color="inherit"
                onClick={handleOpen}
                title="Open daily PnL calendar"
              >
                <CalendarMonthIcon />
              </IconButton>
            )}
          >
            {() =>
              dashboardState ? (
                <DailyPnlCalendarWrapper
                  accountSummaries={dashboardState.accountSummaries}
                  activeMode={dashboardState.activeMode}
                  history={dashboardState.history}
                />
              ) : (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Dashboard state is not loaded yet.
                  </Typography>
                </Box>
              )
            }
          </ButtonDialog>

          <SettingsDialog
            configDraft={configDraft}
            dashboardState={dashboardState}
            onCloseDialog={onSettingsDialogClose}
            onOpenDialog={onSettingsDialogOpen}
            onReinitialize={onReinitialize}
            reinitializing={reinitializing}
            pushLocalStorageToOnline={pushLocalStorageToOnline}
            pushingOnlineStorage={pushingOnlineStorage}
            resetSandbox={resetSandbox}
            resettingSandboxAccount={resettingSandboxAccount}
            saveConfig={saveConfig}
            savingConfig={savingConfig}
            safeHavenUSDT={safeHavenUSDT}
            selectedAccountSlug={selectedAccountSlug}
            setConfigDraft={setConfigDraft}
            setSafeHavenUSDT={setSafeHavenUSDT}
            setSelectedAccountSlug={setSelectedAccountSlug}
            syncOnlineStorageToLocal={syncOnlineStorageToLocal}
            syncingOnlineStorage={syncingOnlineStorage}
            tryWithdrawNow={tryWithdrawNow}
            tryingWithdraw={tryingWithdraw}
          />

          <DarkToggle />
        </>
      ) : null}

      <UtcClock />

      <ButtonLogout />
    </Box>
  );
}
