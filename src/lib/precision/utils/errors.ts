import { systemNotif } from "../../system/notification";
import { runtimeLogs } from "../../system/storage";

/**
 * Persists a stage/cycle failure to the error log without breaking the loop,
 * and reports it once per hour bucket through the NOTIF_ERROR channel so an
 * operational fault is visible without spamming on every failing pass.
 */
async function recordRuntimeError(source: string, error: unknown) {
  await runtimeLogs
    ?.appendError?.({ source, error })
    ?.catch(() => undefined);

  const message = error instanceof Error ? error.message : String(error);
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  await systemNotif
    .central({
      dashboard: "SLOW",
      dedupeKey: `slow-operational-error:${source}:${message}:${hourBucket}`,
      // PROD:NOTIF_ERROR
      key: "NOTIF_ERROR",
      message: JSON.stringify(
        {
          details: { source },
          error: message,
          source,
          stack: error instanceof Error ? error.stack : undefined,
        },
        null,
        2,
      ),
      title: `[ERROR] ${source}`,
    })
    .catch(() => undefined);
}

/** Returns true when a thrown error is an AbortError shutdown signal. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const runtimeErrors = {
  isAbort: isAbortError,
  record: recordRuntimeError,
} as const;

export default runtimeErrors;
export { runtimeErrors };
