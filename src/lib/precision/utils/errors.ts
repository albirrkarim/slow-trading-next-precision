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

/**
 * Creates a per-instance tracker that records a recurring miss as an error
 * only once it has persisted past `graceMs`, then re-records at `repeatMs`
 * while the outage lasts. `ok(key)` clears a key so the next outage logs
 * fresh. Keep one tracker per engine instance — shared state would let one
 * runtime suppress another's logs.
 */
function trackMisses(options: {
  graceMs: number;
  repeatMs: number;
  source: string;
}) {
  const misses: Record<
    string,
    { loggedAt?: number; since: number } | undefined
  > = {};

  return {
    /**
     * Marks `key` as missing; once the outage outlives the grace window,
     * `build(outageMs)` is recorded — repeating at `repeatMs` while it lasts.
     */
    miss(key: string, build: (outageMs: number) => Error): void {
      const entry = (misses[key] ??= { since: Date.now() });
      const now = Date.now();
      const outageMs = now - entry.since;
      if (outageMs < options.graceMs) return;
      if (
        entry.loggedAt !== undefined &&
        now - entry.loggedAt < options.repeatMs
      ) {
        return;
      }
      entry.loggedAt = now;
      void recordRuntimeError(options.source, build(outageMs)).catch(
        () => undefined,
      );
    },
    /** Clears a key so the next miss starts a fresh outage. */
    ok(key: string): void {
      delete misses[key];
    },
  };
}

const runtimeErrors = {
  isAbort: isAbortError,
  record: recordRuntimeError,
  trackMisses,
} as const;

export default runtimeErrors;
export { runtimeErrors };
