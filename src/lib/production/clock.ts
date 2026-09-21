import type { RuntimeClock } from "@/lib/precision/types";

interface ProductionClockOptions {
  signal: AbortSignal;
  now?: () => number;
}

function createAbortError(): Error {
  const error = new Error("Production runtime stopped.");
  error.name = "AbortError";
  return error;
}

function waitUntil(
  time: number,
  signal: AbortSignal,
  now: () => number,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  const delayMs = Math.max(0, time - now());
  if (delayMs === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Creates the wall-clock implementation used by live and sandbox modes. */
function create(options: ProductionClockOptions): RuntimeClock {
  const now = options.now ?? Date.now;
  let currentTime = now();

  return {
    async advanceTo(nextTime) {
      if (options.signal.aborted) {
        throw createAbortError();
      }

      const targetTime = Math.max(nextTime, now());
      await waitUntil(targetTime, options.signal, now);
      currentTime = targetTime;
    },
    finished() {
      return options.signal.aborted;
    },
    now() {
      return currentTime;
    },
  };
}

const clock = { create } as const;

export default clock;
export { clock };
export type { ProductionClockOptions };
