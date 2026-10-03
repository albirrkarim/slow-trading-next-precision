"use client";

import {
  Grid,
  Stack,
} from "@mui/material";
import axios from "axios";
import { useCallback, useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import TypographyTooltip from "@/components/ui/TypographyTooltip";

import {
  SlowTradingConfigLogs,
  SlowTradingErrorLogs,
  SlowTradingManagementLogs,
  SlowTradingSafeHavenLogs,
  SlowTradingWithdrawalLogs,
} from "../../logs/SlowTradingLogs";
import {
  SafeHavenQueueCreateDialog,
  WithdrawalQueueCreateDialog,
} from "../SlowTradingQueueDialogs";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { RuntimeManualQueueCreateInput, RuntimeQueues } from "@/lib/system/queue";

import { QueueSection } from "./QueueSection";
import { SafeHavenScheduleTooltip, WithdrawalScheduleTooltip } from "./ScheduleTooltips";
import type { SlowTradingQueueRow } from "./utils";
import {
  getSuggestedSafeHavenAmountUSDT,
  QUEUE_POLL_INTERVAL_MS,
} from "./utils";

export default function SlowTradingQueuesPanel(props: {
  dashboardState: RuntimeDashboardState | null;
}) {
  const { dashboardState } = props;
  const [queues, setQueues] = useState<RuntimeQueues>({
    safeHaven: [],
    withdrawals: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scheduleNow, setScheduleNow] = useState(0);

  const loadQueues = useCallback(async () => {
    try {
      const response = await axios.get<RuntimeQueues>(
        endpoints.system.queue,
      );
      setQueues(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
          requestError?.message ??
          "Failed to load queues",
      );
    } finally {
      setScheduleNow(Date.now());
      setLoading(false);
    }
  }, []);

  const createQueue = useCallback(
    async (input: RuntimeManualQueueCreateInput) => {
      try {
        await axios.post(endpoints.system.queue, input);
        await loadQueues();
      } catch (requestError: any) {
        throw new Error(
          requestError?.response?.data?.error ??
            requestError?.message ??
            "Failed to create queue item",
        );
      }
    },
    [loadQueues],
  );

  useEffect(() => {
    void loadQueues();
    const intervalId = window.setInterval(() => {
      void loadQueues();
    }, QUEUE_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadQueues]);

  const deleteQueue = useCallback(async (row: SlowTradingQueueRow) => {
    if (
      !confirm(
        "Delete this pending queue item? Its scheduler will wait until the next normal scheduled time.",
      )
    ) {
      return;
    }

    setDeletingId(row.id);
    setError(null);
    try {
      await axios.delete(endpoints.system.queue, {
        params: {
          id: row.id,
          kind: row.kind,
        },
      });
      setQueues((current) => ({
        safeHaven:
          row.kind === "safe_haven"
            ? current.safeHaven.filter((item) => item.id !== row.id)
            : current.safeHaven,
        withdrawals:
          row.kind === "withdrawal"
            ? current.withdrawals.filter((item) => item.id !== row.id)
            : current.withdrawals,
      }));
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.error ??
          requestError?.message ??
          "Failed to delete queue item",
      );
    } finally {
      setDeletingId(null);
    }
  }, []);
  const suggestedSafeHavenAmountUSDT =
    getSuggestedSafeHavenAmountUSDT(dashboardState);
  const activeSafeHavenQueues = queues.safeHaven.filter(
    (item) => item.mode === dashboardState?.activeMode,
  );
  const availableWithdrawalSchedules =
    dashboardState?.runtime.withdrawal.schedules.filter(
      (schedule) =>
        !queues.withdrawals.some(
          (item) => item.scheduleId === schedule.id,
        ),
    ) ?? [];

  return (
    <Stack spacing={2}>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2}>
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="space-between"
              spacing={1}
            >
              <TypographyTooltip
                tooltipMaxWidth={480}
                tooltipTitle={
                  <SafeHavenScheduleTooltip
                    dashboardState={dashboardState}
                    now={scheduleNow}
                    queues={activeSafeHavenQueues}
                  />
                }
                sx={{ mb: 0 }}
                variant="h6"
              >
                Safe Haven
              </TypographyTooltip>
              <SafeHavenQueueCreateDialog
                activeMode={dashboardState?.activeMode ?? "sandbox"}
                disabled={activeSafeHavenQueues.some(
                  (item) => !item.scheduleId,
                )}
                onCreate={createQueue}
                suggestedAmountUSDT={suggestedSafeHavenAmountUSDT}
              />
            </Stack>
            <QueueSection
              deletingId={deletingId}
              error={error}
              loading={loading}
              onDelete={deleteQueue}
              rememberExpand="slow-trading-queue:safe-haven"
              rows={activeSafeHavenQueues}
            />
            <SlowTradingSafeHavenLogs />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2}>
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="space-between"
              spacing={1}
            >
              <TypographyTooltip
                tooltipMaxWidth={560}
                tooltipTitle={
                  <WithdrawalScheduleTooltip
                    dashboardState={dashboardState}
                    now={scheduleNow}
                    queues={queues.withdrawals}
                  />
                }
                sx={{ mb: 0 }}
                variant="h6"
              >
                Withdraw
              </TypographyTooltip>
              <WithdrawalQueueCreateDialog
                activeMode={dashboardState?.activeMode ?? "sandbox"}
                autoEnabled={
                  dashboardState?.runtime.withdrawal.autoEnabled ?? false
                }
                disabled={!dashboardState}
                exchangeType={dashboardState?.config.exchangeType ?? ""}
                onCreate={createQueue}
                schedules={availableWithdrawalSchedules}
              />
            </Stack>
            <QueueSection
              deletingId={deletingId}
              error={error}
              loading={loading}
              onDelete={deleteQueue}
              rememberExpand="slow-trading-queue:withdrawal"
              rows={queues.withdrawals}
            />
            <SlowTradingWithdrawalLogs />
          </Stack>
        </Grid>
      </Grid>

      <SlowTradingErrorLogs />
      <SlowTradingManagementLogs />
      <SlowTradingConfigLogs />
    </Stack>
  );
}
