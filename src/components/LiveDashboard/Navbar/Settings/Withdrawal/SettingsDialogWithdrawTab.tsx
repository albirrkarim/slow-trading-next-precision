"use client";

import {
  Alert,
  Box,
  Grid,
  Stack,
  Switch,
  Typography,
} from "@mui/material";

import SettingsDialogSection from "../Components/SettingsDialogSection";
import SettingsInfoField from "../Components/SettingsInfoField";
import type {
  ConfigDraft,
  ConfigDraftSetter,
  WithdrawalScheduleDraft,
  WithdrawalWalletDraft,
} from "../settings-types";
import { WithdrawalScheduleCreateDialog } from "./WithdrawalScheduleDialogs";
import WithdrawalScheduleTable from "./WithdrawalScheduleTable";
import { WithdrawalWalletCreateDialog } from "./WithdrawalWalletDialogs";
import WithdrawalWalletTable from "./WithdrawalWalletTable";

interface SettingsDialogWithdrawTabProps {
  configDraft: ConfigDraft;
  safeHavenUSDT: number;
  setSafeHavenUSDT: (value: number) => void;
  setConfigDraft: ConfigDraftSetter;
  tryWithdrawNow: (scheduleId: string) => Promise<void>;
  tryingWithdraw: boolean;
}

export default function SettingsDialogWithdrawTab({
  configDraft,
  safeHavenUSDT,
  setSafeHavenUSDT,
  setConfigDraft,
  tryWithdrawNow,
  tryingWithdraw,
}: SettingsDialogWithdrawTabProps) {
  const updateWithdrawal = (
    updater: (current: ConfigDraft["runtime"]["withdrawal"]) =>
      ConfigDraft["runtime"]["withdrawal"],
  ) => {
    setConfigDraft((prev) =>
      prev
        ? {
            ...prev,
            runtime: {
              ...prev.runtime,
              withdrawal: updater(prev.runtime.withdrawal),
            },
          }
        : prev,
    );
  };

  const addWallet = (wallet: WithdrawalWalletDraft) => {
    updateWithdrawal((current) => ({
      ...current,
      walletBook: [...current.walletBook, wallet],
    }));
  };

  const updateWallet = (updatedWallet: WithdrawalWalletDraft) => {
    updateWithdrawal((current) => ({
      ...current,
      walletBook: current.walletBook.map((wallet) =>
        wallet.id === updatedWallet.id ? updatedWallet : wallet,
      ),
    }));
  };

  const deleteWallet = (walletId: string) => {
    updateWithdrawal((current) => {
      const wallet = current.walletBook.find(
        (candidate) => candidate.id === walletId,
      );

      return {
        ...current,
        walletBook: current.walletBook.filter(
          (candidate) => candidate.id !== walletId,
        ),
        schedules: current.schedules.map((schedule) =>
          schedule.walletId === walletId
            ? {
              ...schedule,
              walletId: "",
              targetNetwork: wallet?.network ?? schedule.targetNetwork,
              targetWalletAddress:
                wallet?.address ?? schedule.targetWalletAddress,
            }
            : schedule,
        ),
      };
    });
  };

  const addSchedule = (schedule: WithdrawalScheduleDraft) => {
    updateWithdrawal((current) => ({
      ...current,
      schedules: [...current.schedules, schedule],
    }));
  };

  const updateSchedule = (updatedSchedule: WithdrawalScheduleDraft) => {
    updateWithdrawal((current) => ({
      ...current,
      schedules: current.schedules.map((schedule) =>
        schedule.id === updatedSchedule.id ? updatedSchedule : schedule,
      ),
    }));
  };

  const deleteSchedule = (scheduleId: string) => {
    updateWithdrawal((current) => {
      const nextSchedules = current.schedules.filter(
        (schedule) => schedule.id !== scheduleId,
      );

      return { ...current, schedules: nextSchedules };
    });
  };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 4 }}>
        <SettingsDialogSection
          title="Manual Withdrawal"
          description="Edit the current Safe Haven balance after you manually withdraw or deposit reserve USDT outside the bot."
        >
          <Stack spacing={2}>
            <SettingsInfoField
              label="Safe Haven Balance (USDT)"
              type="number"
              size="small"
              fullWidth
              value={safeHavenUSDT}
              onChange={(event) =>
                setSafeHavenUSDT(Math.max(0, Number(event.target.value) || 0))
              }
              info="This updates the active mode Safe Haven value used by SLOW balance math. It does not send funds on-chain."
            />

            <Alert severity="info">
              Safe Haven is an internal reserve number. If you move funds
              manually on the exchange, update this value so SLOW keeps the
              available balance correct.
            </Alert>
          </Stack>
        </SettingsDialogSection>
      </Grid>

      <Grid size={{ xs: 12, md: 8 }}>
        <SettingsDialogSection
          title="Wallet Book"
          description="Remember target wallets so schedules can reuse the same network and address."
        >
          <Stack spacing={2}>
            <Stack
              alignItems={{ xs: "stretch", sm: "center" }}
              direction={{ xs: "column", sm: "row" }}
              justifyContent="flex-end"
            >
              <WithdrawalWalletCreateDialog
                onCreate={addWallet}
                walletCount={configDraft.runtime.withdrawal.walletBook.length}
              />
            </Stack>

            <WithdrawalWalletTable
              onDelete={deleteWallet}
              onUpdate={updateWallet}
              schedules={configDraft.runtime.withdrawal.schedules}
              wallets={configDraft.runtime.withdrawal.walletBook}
            />
          </Stack>
        </SettingsDialogSection>
      </Grid>

      <Grid size={{ xs: 12 }}>
        <SettingsDialogSection
          title="Recurring Withdrawal Schedules"
          description="Create one schedule per recurring payment. Use the row actions to update, delete, or submit a capped real-withdrawal test."
        >
          <Stack spacing={2}>
            <Stack
              alignItems={{ xs: "stretch", sm: "center" }}
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={1.5}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Switch
                    checked={configDraft.runtime.withdrawal.autoEnabled}
                    onChange={(event) =>
                      updateWithdrawal((current) => ({
                        ...current,
                        autoEnabled: event.target.checked,
                      }))
                    }
                    color="default"
                    size="small"
                  />
                  <Typography variant="body2" fontWeight="bold">
                    Auto Withdrawal:{" "}
                    {configDraft.runtime.withdrawal.autoEnabled ? "ON" : "OFF"}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", ml: { xs: 0, sm: 6 }, mt: -0.5 }}
                >
                  The production SLOW runner creates due queue items
                  automatically. Schedule changes are persisted with the main
                  Save button.
                </Typography>
              </Box>

              <WithdrawalScheduleCreateDialog
                accounts={configDraft.accounts}
                onCreate={addSchedule}
                scheduleCount={configDraft.runtime.withdrawal.schedules.length}
                walletBook={configDraft.runtime.withdrawal.walletBook}
              />
            </Stack>

            <WithdrawalScheduleTable
              accounts={configDraft.accounts}
              onDelete={deleteSchedule}
              onTest={tryWithdrawNow}
              onUpdate={updateSchedule}
              schedules={configDraft.runtime.withdrawal.schedules}
              testing={tryingWithdraw}
              walletBook={configDraft.runtime.withdrawal.walletBook}
            />
          </Stack>
        </SettingsDialogSection>
      </Grid>
    </Grid>
  );
}
