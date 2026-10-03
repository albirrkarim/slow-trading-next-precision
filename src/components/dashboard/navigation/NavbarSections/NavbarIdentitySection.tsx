"use client";

import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import {
  Box,
  Chip,
  Typography,
} from "@mui/material";

import SidebarButton from "@/components/ui/SidebarButton";

import { computeBalanceSummaryFromBalances } from "@/components/settings/helpers";
import NavbarBalanceSummary from "../NavbarBalanceSummary";
import NavbarBalanceRefreshButton from "../NavbarBalanceRefreshButton";
import NavbarInstanceIp from "../NavbarInstanceIp";
import NavbarStageRuns from "../NavbarStageRuns";
import NavbarStrategyChip from "../NavbarStrategyChip";
import NavbarVolatilityThreshold from "../NavbarVolatilityThreshold";
import type {
  ConfigDraft,
  DashboardState,
} from "../navbar-types";

interface NavbarIdentitySectionProps {
  configDraft: ConfigDraft | null;
  dashboardState: DashboardState | null;
  onRefreshBalance?: (accountSlug: string) => Promise<void>;
  refreshingBalanceAccount?: string | null;
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

      {dashboardState && (
        <NavbarStrategyChip
          strategy={
            configDraft?.management.strategy || dashboardState.config.strategy
          }
        />
      )}

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
                label={account.name}
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
