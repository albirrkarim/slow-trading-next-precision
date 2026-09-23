import type {
  RuntimeMode,
  RuntimeSafeHavenSchedule,
} from "../runtime/types";
import runtimeWithdrawalSchedule from "../withdrawal/schedule";

/** Returns a schedule view compatible with the shared monthly timing rules. */
function toMonthlySchedule(
  schedule: RuntimeSafeHavenSchedule,
  mode: RuntimeMode,
) {
  return {
    ...schedule,
    lastQueuedAt: schedule.lastQueuedAt?.[mode],
    lastSuccessAt: undefined,
  };
}

/** Checks whether one Safe Haven schedule is due for a specific mode. */
function isDue(
  schedule: RuntimeSafeHavenSchedule,
  mode: RuntimeMode,
  currentTimeMs: number,
): boolean {
  return runtimeWithdrawalSchedule.timing.isDue(
    toMonthlySchedule(schedule, mode),
    currentTimeMs,
  );
}

/** Resolves the current or next Safe Haven occurrence for a mode. */
function getNextOccurrenceAt(
  schedule: RuntimeSafeHavenSchedule,
  mode: RuntimeMode,
  currentTimeMs: number,
): number {
  return runtimeWithdrawalSchedule.timing.getNextOccurrenceAt(
    toMonthlySchedule(schedule, mode),
    currentTimeMs,
  );
}

const runtimeSafeHavenSchedule = {
  timing: {
    getNextOccurrenceAt,
    getOccurrenceAt:
      runtimeWithdrawalSchedule.timing.getOccurrenceAt,
    isDue,
  },
  values: runtimeWithdrawalSchedule.values,
} as const;

export default runtimeSafeHavenSchedule;
export { runtimeSafeHavenSchedule };
