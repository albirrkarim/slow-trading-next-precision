"use client";

import type { ReactElement, ReactNode } from "react";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HistoryIcon from "@mui/icons-material/History";
import {
  Box,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";

import DailyPnlCalendarWrapper from "@/components/LiveDashboard/Feature/DailyPnlCalendarWrapper";
import ButtonDialog from "@/components/ui/ButtonDialog";
import ButtonLogout from "@/components/ui/ButtonLogout";
import DarkToggle from "@/components/ui/DarkToggle";
import SidebarButton from "@/components/ui/SidebarButton";

import UtcClock from "../Feature/UtcClock";
import SlowTradingReporting from "../Reporting";
import {
  computeBalanceSummaryFromBalances,
  getPnlPercentBg,
} from "./Settings/helpers";
import NavbarBalanceSummary from "./NavbarBalanceSummary";
import NavbarBalanceRefreshButton from "./NavbarBalanceRefreshButton";
import NavbarInstanceIp from "./NavbarInstanceIp";
import NavbarStageRuns from "./NavbarStageRuns";
import NavbarVolatilityThreshold from "./NavbarVolatilityThreshold";
import SettingsDialog from "./Settings/SettingsDialog";
import type {
  ConfigDraft,
  DashboardState,
  DayPreviewSummary,
  LiveDashboardNavbarProps,
  OpenPositionSummary,
} from "./navbar-types";

interface NavbarIdentitySectionProps {
  configDraft: ConfigDraft | null;
  dashboardState: DashboardState | null;
  onRefreshBalance?: (accountSlug: string) => Promise<void>;
  refreshingBalanceAccount?: string | null;
}

const balanceTooltipSlotProps = {
  tooltip: {
    sx: {
      maxWidth: 420,
      p: 1.25,
      fontSize: "0.85rem",
      lineHeight: 1.45,
    },
  },
};

function BalanceTooltip({
  children,
  title,
}: {
  children: ReactElement;
  title: ReactNode;
}) {
  return (
    <Tooltip
      arrow
      placement="bottom-start"
      slotProps={balanceTooltipSlotProps}
      title={title}
    >
      {children}
    </Tooltip>
  );
}

function BalanceTooltipText({
  description,
  formula,
}: {
  description: string;
  formula: string;
}) {
  return (
    <Box>
      <Typography
        component="div"
        sx={{ fontSize: "0.85rem", fontWeight: 700, mb: 0.5 }}
      >
        {description}
      </Typography>
      <Typography
        component="div"
        sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
      >
        {formula}
      </Typography>
    </Box>
  );
}

export function NavbarIdentitySection({
  configDraft,
  dashboardState,
  onRefreshBalance,
  refreshingBalanceAccount = null,
}: NavbarIdentitySectionProps) {
  const accountSummaries = dashboardState
    ? (dashboardState.accountSummaries ?? [
      {
        slug:
          dashboardState.accountFilter ??
          dashboardState.accounts[0]?.slug ??
          "",
        name:
          dashboardState.accounts.find(
            (account) => account.slug === dashboardState.accountFilter,
          )?.name ??
          dashboardState.accountFilter ??
          "",
        enabled: true,
        activeMode: dashboardState.activeMode,
        balances: dashboardState.balances,
      },
    ]).filter((account) => account.enabled)
    : [];
  const activeModes = new Set(
    accountSummaries.map((account) => account.activeMode),
  );
  const modeLabel =
    activeModes.size === 1
      ? accountSummaries[0]?.activeMode.toUpperCase()
      : "MULTI MODE";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: { xs: 0.75, md: 1 },
        flexWrap: { xs: "wrap", md: "wrap", xl: "nowrap" },
        gridArea: "identity",
        minWidth: 0,
      }}
    >
      <SidebarButton />

      <NavbarInstanceIp snapshot={dashboardState?.instanceIp} />

      {dashboardState && configDraft ? (
        <Box
          sx={{
            flex: {
              xs: "1 1 calc(100% - 44px)",
              sm: "1 1 auto",
              md: "0 1 auto",
            },
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <Typography
              variant="body1"
              fontWeight="bold"
              sx={{ fontSize: { xs: "0.95rem", md: "1rem" }, minWidth: 0 }}
            >
              {(
                configDraft.management.decisionEngineVersion ||
                dashboardState.config.decisionEngineVersion ||
                "decision.v14"
              ).replace("decision.", "")}
              {modeLabel && ` - ${modeLabel}`}
            </Typography>
            <NavbarVolatilityThreshold
              volatilityThresholdPct={
                dashboardState.globalConfig.volatilityThresholdPct
              }
            />
          </Box>
          <NavbarStageRuns dashboardState={dashboardState} />
        </Box>
      ) : null}

      {dashboardState && (
        <Box
          sx={{
            alignItems: "stretch",
            display: "flex",
            flex: "1 1 auto",
            flexWrap: "wrap",
            gap: 0.75,
            minWidth: 0,
          }}
        >
          {accountSummaries.map((account) => (
            <Box
              aria-label={`${account.name} balance`}
              key={account.slug}
              role="group"
              sx={{
                alignItems: "center",
                display: "flex",
                flex: "1 1 220px",
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Chip
                size="small"
                icon={<AccountCircleIcon fontSize="small" />}
                label={`${account.name} · ${account.activeMode.toUpperCase()}`}
                variant="outlined"
                color="default"
                sx={{ maxWidth: 150 }}
                title={`Account slug: ${account.slug}`}
              />
              <NavbarBalanceSummary
                balanceSummary={computeBalanceSummaryFromBalances(
                  account.balances,
                )}
              />
              {account.activeMode === "live" && onRefreshBalance && (
                <NavbarBalanceRefreshButton
                  accountName={account.name}
                  disabled={
                    refreshingBalanceAccount !== null ||
                    Boolean(dashboardState.binanceHealth?.current)
                  }
                  loading={refreshingBalanceAccount === account.slug}
                  onRefresh={() => onRefreshBalance(account.slug)}
                />
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface NavbarDayPreviewSectionProps {
  dashboardState: DashboardState | null;
  dayPreview: DayPreviewSummary;
  openPositionSummary: OpenPositionSummary;
}

export function NavbarDayPreviewSection({
  dashboardState,
  dayPreview,
  openPositionSummary,
}: NavbarDayPreviewSectionProps) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: { xs: 0.5, md: 1 },
        flexWrap: "wrap",
        alignItems: "center",
        gridArea: "pnl",
        justifySelf: { xs: "start", xl: "center" },
        minWidth: 0,
      }}
    >
      {dashboardState ? (
        <>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Open-position floating PnL in USDT. It sums position.pnl.netUsdt across open positions."
                formula="position.pnl.netUsdt = gross price PnL - estimated round-trip fees; futures uses leveraged size"
              />
            }
          >
            <Chip
              size="small"
              label={`PnL: $${openPositionSummary.totalPnlUSDT >= 0 ? "+" : ""}${openPositionSummary.totalPnlUSDT.toFixed(2)}`}
              sx={(theme) => ({
                bgcolor:
                  openPositionSummary.totalPnlUSDT >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                color: theme.palette.getContrastText(
                  openPositionSummary.totalPnlUSDT >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Average floating PnL percent across open positions."
                formula="avg = average(position.pnl.netPct)"
              />
            }
          >
            <Chip
              size="small"
              label={`Avg: ${openPositionSummary.avgPnlPercent.toFixed(2)}%`}
              sx={(theme) => ({
                bgcolor: getPnlPercentBg(
                  theme,
                  openPositionSummary.avgPnlPercent,
                ),
                color: theme.palette.getContrastText(
                  getPnlPercentBg(theme, openPositionSummary.avgPnlPercent),
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Today's realized closed-trade PnL in USDT from trade history."
                formula="USD = sum(history.pnl.netUsdt for today)"
              />
            }
          >
            <Chip
              size="small"
              label={`USD: ${dayPreview.dailyUsdtProfit >= 0 ? "+" : ""}$${dayPreview.dailyUsdtProfit.toFixed(2)}`}
              sx={(theme) => ({
                bgcolor:
                  dayPreview.dailyUsdtProfit >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                color: theme.palette.getContrastText(
                  dayPreview.dailyUsdtProfit >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Today's realized closed-trade PnL percent from trade history."
                formula="PnL % = sum(history.pnl.netPct for today)"
              />
            }
          >
            <Chip
              size="small"
              label={`PnL: ${dayPreview.dailyPnlPercentSum >= 0 ? "+" : ""}${dayPreview.dailyPnlPercentSum.toFixed(2)}%`}
              sx={(theme) => ({
                bgcolor: getPnlPercentBg(theme, dayPreview.dailyPnlPercentSum),
                color: theme.palette.getContrastText(
                  getPnlPercentBg(theme, dayPreview.dailyPnlPercentSum),
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
        </>
      ) : null}
    </Box>
  );
}

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
                title="Open slow-trading history report"
                color="inherit"
              >
                <HistoryIcon />
              </IconButton>
            )}
          >
            {() =>
              dashboardState ? (
                <SlowTradingReporting
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
