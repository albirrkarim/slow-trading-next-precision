"use client";

import { useEffect, useMemo, useState } from "react";

import axios from "axios";

import { endpoints } from "@/components/endpoints";
import { tradeLog } from "@/lib/trading/helper/log";

import {
  computeAutoEntryActive,
  computeDayPreview,
  computeOpenPositionSummary,
  makeConfigDraft,
} from "./Settings/helpers";
import type {
  ConfigDraft,
  ConfigDraftSetter,
  DashboardState,
  LiveDashboardNavbarProps,
} from "./navbar-types";

interface SlowTradingRunResponse {
  mode: "live" | "sandbox";
  reports: Array<{ message: string }>;
  executedEntrySignals: number;
  availableQuoteAsset: number;
  lastRunAt?: number;
  skipped?: boolean;
}

interface SlowTradingWithdrawTryResponse {
  message: string;
}

interface UseLiveDashboardNavbarArgs {
  dashboardState: DashboardState | null;
  onRefresh: LiveDashboardNavbarProps["onRefresh"];
}

function buildWithdrawalPayload(configDraft: ConfigDraft) {
  const withdrawal = configDraft.runtime.withdrawal;
  return {
    autoEnabled: withdrawal.autoEnabled,
    schedules: withdrawal.schedules.map((schedule, index) => ({
      id: schedule.id || `schedule-${index + 1}`,
      account: schedule.account || configDraft.runtime.exchangeAccountSlug,
      name: schedule.name || `Schedule ${index + 1}`,
      enabled: schedule.enabled,
      amountUSDT: Math.max(0, Number(schedule.amountUSDT) || 0),
      dayOfMonth: Math.min(
        31,
        Math.max(1, Math.floor(Number(schedule.dayOfMonth) || 1)),
      ),
      walletId: schedule.walletId || undefined,
      targetNetwork: schedule.targetNetwork,
      targetWalletAddress: schedule.targetWalletAddress,
      lastAttemptAt: schedule.lastAttemptAt,
      lastSuccessAt: schedule.lastSuccessAt,
      lastQueuedAt: schedule.lastQueuedAt,
      lastStatus: schedule.lastStatus,
    })),
    walletBook: withdrawal.walletBook.map((wallet, index) => ({
      id: wallet.id || `wallet-${index + 1}`,
      name: wallet.name || `Wallet ${index + 1}`,
      network: wallet.network,
      address: wallet.address,
    })),
  };
}

export function useLiveDashboardNavbar({
  dashboardState,
  onRefresh,
}: UseLiveDashboardNavbarArgs) {
  const [configDraft, setConfigDraftState] = useState<ConfigDraft | null>(null);
  const [safeHavenUSDT, setSafeHavenUSDT] = useState(0);
  const [runningCycle, setRunningCycle] = useState(false);
  const [refreshingBalanceAccount, setRefreshingBalanceAccount] = useState<
    string | null
  >(null);
  const [resettingSandboxAccount, setResettingSandboxAccount] = useState<
    string | null
  >(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingOnlineStorage, setSyncingOnlineStorage] = useState(false);
  const [tryingWithdraw, setTryingWithdraw] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isConfigDraftDirty, setIsConfigDraftDirty] = useState(false);

  useEffect(() => {
    if (!dashboardState) {
      setConfigDraftState(null);
      return;
    }

    if (isSettingsDialogOpen && isConfigDraftDirty) {
      return;
    }

    setConfigDraftState(makeConfigDraft(dashboardState));
    setSafeHavenUSDT(dashboardState.balances.safeHaven ?? 0);
  }, [dashboardState, isConfigDraftDirty, isSettingsDialogOpen]);

  const setConfigDraft: ConfigDraftSetter = (value) => {
    if (isSettingsDialogOpen) {
      setIsConfigDraftDirty(true);
    }

    setConfigDraftState((prev) =>
      typeof value === "function" ? value(prev) : value,
    );
  };

  const openSettingsDialog = () => {
    setIsSettingsDialogOpen(true);
    setIsConfigDraftDirty(false);
  };

  const closeSettingsDialog = () => {
    setIsSettingsDialogOpen(false);
    setIsConfigDraftDirty(false);
  };

  const saveConfig = async (handleClose?: () => void) => {
    if (!configDraft) {
      return;
    }

    setSavingConfig(true);
    try {
      if (configDraft.management.symbols.length === 0) {
        alert("Please define at least one symbol");
        return;
      }

      const { mcp: _mcp, ...runtime } = configDraft.runtime;

      await axios.put(endpoints.slow.prod.exchangeAccounts, {
        accounts: configDraft.accounts,
        exchangeAccountSlug: configDraft.runtime.exchangeAccountSlug,
      });

      await axios.put(endpoints.slow.prod.storage, {
        config: configDraft.management,
        ...runtime,
        safeHavenUSDT: Math.max(0, Number(safeHavenUSDT) || 0),
      });

      setIsConfigDraftDirty(false);
      handleClose?.();
      await onRefresh();
    } catch (error: any) {
      tradeLog.error(error);
      alert(error.response?.data?.error ?? "Save config failed");
    } finally {
      setSavingConfig(false);
    }
  };

  const tryWithdrawNow = async (scheduleId: string) => {
    if (!configDraft) {
      return;
    }

    const schedule = configDraft.runtime.withdrawal.schedules.find(
      (item) => item.id === scheduleId,
    );
    if (!schedule) {
      alert("Please choose a withdrawal schedule first.");
      return;
    }

    setTryingWithdraw(true);
    try {
      await axios.put(endpoints.slow.prod.storage, {
        safeHavenUSDT: Math.max(0, Number(safeHavenUSDT) || 0),
        withdrawal: buildWithdrawalPayload(configDraft),
      });

      const response = await axios.post<SlowTradingWithdrawTryResponse>(
        endpoints.slow.prod.withdraw,
        { scheduleId },
      );
      alert(response.data.message);
      setIsConfigDraftDirty(false);
      await onRefresh();
    } catch (error: any) {
      tradeLog.error(error);
      alert(
        error?.response?.data?.message ??
          error?.response?.data?.error ??
          "Try withdraw flow failed",
      );
    } finally {
      setTryingWithdraw(false);
    }
  };

  const runCycle = async () => {
    setRunningCycle(true);
    try {
      await axios.post<SlowTradingRunResponse>(endpoints.slow.prod.run, {});
      await onRefresh();
    } catch (error) {
      tradeLog.error(error);
      alert("Run cycle failed");
    } finally {
      setRunningCycle(false);
    }
  };

  const refreshBalance = async (accountSlug: string) => {
    setRefreshingBalanceAccount(accountSlug);
    try {
      await axios.post(endpoints.slow.prod.balanceRefresh, {
        account: accountSlug,
      });
      await onRefresh();
    } catch (error: any) {
      tradeLog.error(error);
      alert(
        error?.response?.data?.error ??
          `Failed to refresh live balance for ${accountSlug}`,
      );
    } finally {
      setRefreshingBalanceAccount(null);
    }
  };

  const resetSandbox = async (accountSlug: string) => {
    if (!configDraft) {
      return;
    }
    const account = configDraft.accounts.find(
      (candidate) => candidate.slug === accountSlug,
    );
    if (!account) {
      alert("Account not found");
      return;
    }

    if (
      !confirm(
        `Reset ${account.name} sandbox positions, history, and balance to its configured initial balance?`,
      )
    ) {
      return;
    }

    setResettingSandboxAccount(account.slug);
    try {
      const initialBalanceUSDT = Math.max(
        0,
        Number(account.sandbox.initialBalanceUSDT) || 0,
      );
      await axios.post(endpoints.slow.prod.reset, {
        account: account.slug,
        initialBalanceUSDT,
      });
      await onRefresh();
    } catch (error) {
      tradeLog.error(error);
      alert("Reset sandbox failed");
    } finally {
      setResettingSandboxAccount(null);
    }
  };

  const syncOnlineStorageToLocal = async (onlineBaseUrl: string) => {
    const normalizedOnlineBaseUrl = onlineBaseUrl.trim();

    if (!normalizedOnlineBaseUrl) {
      alert("Please enter the online base URL to sync from.");
      return;
    }

    if (
      !confirm(
        `Replace this server's persistent storage with storage from ${normalizedOnlineBaseUrl}? A timestamped backup of this server will be created first.`,
      )
    ) {
      return;
    }

    setSyncingOnlineStorage(true);
    try {
      const response = await axios.post(endpoints.slow.prod.syncOnlineToLocal, {
        onlineBaseUrl: normalizedOnlineBaseUrl,
      });
      const backupPath = response.data?.backupPath
        ? `\nBackup: ${response.data.backupPath}`
        : "";
      alert(
        `Storage cloned from ${normalizedOnlineBaseUrl} to this server.${backupPath}`,
      );
      setIsConfigDraftDirty(false);
    } catch (error: any) {
      tradeLog.error(error);
      alert(
        error?.response?.data?.error ??
          error?.response?.data?.message ??
          "Storage clone failed",
      );
    } finally {
      setSyncingOnlineStorage(false);
    }
  };

  const isActive = computeAutoEntryActive(dashboardState);

  const openPositionSummary = useMemo(
    () => computeOpenPositionSummary(dashboardState),
    [dashboardState],
  );

  const dayPreview = useMemo(
    () => computeDayPreview(dashboardState),
    [dashboardState],
  );

  return {
    configDraft,
    dayPreview,
    isActive,
    openPositionSummary,
    refreshBalance,
    refreshingBalanceAccount,
    resetSandbox,
    resettingSandboxAccount,
    runCycle,
    runningCycle,
    saveConfig,
    safeHavenUSDT,
    savingConfig,
    syncOnlineStorageToLocal,
    syncingOnlineStorage,
    tryWithdrawNow,
    tryingWithdraw,
    closeSettingsDialog,
    openSettingsDialog,
    setConfigDraft,
    setSafeHavenUSDT,
  };
}
