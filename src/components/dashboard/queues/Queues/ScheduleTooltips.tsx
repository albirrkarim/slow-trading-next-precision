"use client";

import {
  Stack,
  Typography,
} from "@mui/material";

import runtimeWithdrawalSchedule from "@/lib/system/withdrawal/schedule";
import runtimeSafeHavenSchedule from "@/lib/system/safehaven";

import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { RuntimeSafeHavenQueueItem, RuntimeWithdrawalQueueItem } from "@/lib/system/queue";

import { formatDetailedTime, QUEUE_ATTEMPT_INTERVAL_MS } from "./utils";

export function SafeHavenScheduleTooltip(props: {
  dashboardState: RuntimeDashboardState | null;
  now: number;
  queues: RuntimeSafeHavenQueueItem[];
}) {
  const { dashboardState, now, queues } = props;
  if (!dashboardState || now <= 0) {
    return <Typography variant="caption">Loading Safe Haven schedule…</Typography>;
  }

  const schedules = dashboardState.runtime.safeHaven.schedules;

  return (
    <Stack spacing={0.75} sx={{ maxWidth: 460 }}>
      <Typography variant="caption">
        Automatic Safe Haven: {dashboardState.runtime.safeHaven.autoEnabled
          ? "enabled"
          : "disabled"}. The runner checks each schedule independently.
      </Typography>
      {schedules.length === 0 && (
        <Typography variant="caption">
          No Safe Haven schedules are configured.
        </Typography>
      )}
      {schedules.map((schedule) => {
        const pending = queues.find((item) => item.scheduleId === schedule.id);
        const nextAt = runtimeSafeHavenSchedule.timing.getNextOccurrenceAt(
          schedule,
          dashboardState.activeMode,
          now,
        );
        const rule = schedule.amountUSDT > 0
          ? `${schedule.amountUSDT} USDT`
          : `${schedule.pct.toFixed(2)}% of assets`;
        return (
          <Stack key={schedule.id} spacing={0.25}>
            <Typography fontWeight={700} variant="caption">
              {schedule.name}: {rule} on UTC day {schedule.dayOfMonth},{" "}
              {schedule.enabled ? "enabled" : "disabled"}.
            </Typography>
            <Typography variant="caption">
              Next occurrence: {formatDetailedTime(nextAt)}. A due item is
              created on the first runner pass at or after this date.
            </Typography>
            {pending && (
              <Typography variant="caption">
                Pending since {formatDetailedTime(pending.createdAt)}.
              </Typography>
            )}
          </Stack>
        );
      })}
      {!dashboardState.runtime.runnerEnabled && (
        <Typography variant="caption">
          Blocked: the PRECISION runner is disabled.
        </Typography>
      )}
      <Typography variant="caption">
        Pending attempts retry every {QUEUE_ATTEMPT_INTERVAL_MS / 60_000} minutes.
      </Typography>
    </Stack>
  );
}

export function WithdrawalScheduleTooltip(props: {
  dashboardState: RuntimeDashboardState | null;
  now: number;
  queues: RuntimeWithdrawalQueueItem[];
}) {
  const { dashboardState, now, queues } = props;
  if (!dashboardState || now <= 0) {
    return <Typography variant="caption">Loading withdrawal schedules…</Typography>;
  }

  const schedules = dashboardState.runtime.withdrawal.schedules;

  return (
    <Stack spacing={1} sx={{ maxWidth: 520 }}>
      <Typography variant="caption">
        Automatic withdrawal:{" "}
        {dashboardState.runtime.withdrawal.autoEnabled ? "enabled" : "disabled"}.
        The production runner checks pending work every five minutes.
      </Typography>
      {schedules.length === 0 && (
        <Typography variant="caption">
          No withdrawal schedules are configured.
        </Typography>
      )}
      {schedules.map((schedule) => {
        const pending = queues.find(
          (item) => item.scheduleId === schedule.id,
        );
        const nextEligibleAt =
          runtimeWithdrawalSchedule.timing.getNextOccurrenceAt(
            schedule,
            now,
          );
        const isDue = runtimeWithdrawalSchedule.timing.isDue(schedule, now);

        return (
          <Stack key={schedule.id} spacing={0.25}>
            <Typography variant="caption" sx={{ fontWeight: "bold" }}>
              {schedule.name}: {schedule.amountUSDT} USDT on UTC day{" "}
              {schedule.dayOfMonth} each month,{" "}
              {schedule.enabled ? "enabled" : "disabled"}.
            </Typography>
            <Typography variant="caption">
              {isDue ? "Due occurrence" : "Next scheduled occurrence"}:{" "}
              {formatDetailedTime(nextEligibleAt)}. Days unavailable in a short
              month use that month&apos;s final day. The item is created on the
              first active runner pass at or after this time.
            </Typography>
            {pending && (
              <Typography variant="caption">
                Current queue created: {formatDetailedTime(pending.createdAt)}.
                This pending item blocks duplicate creation.
              </Typography>
            )}
          </Stack>
        );
      })}
      {dashboardState.activeMode !== "live" && (
        <Typography variant="caption">
          Blocked: PRECISION is currently in sandbox mode.
        </Typography>
      )}
      {!dashboardState.runtime.runnerEnabled && (
        <Typography variant="caption">
          Blocked: the production runner is disabled.
        </Typography>
      )}
    </Stack>
  );
}
