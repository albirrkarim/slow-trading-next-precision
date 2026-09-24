import fs from "fs-extra";

import binanceRequestCoordinator, {
  type BinanceCooldownPersistence,
  type BinanceCooldownState,
} from "@/lib/exchange/platform/binance/request-coordinator";

import storageFiles from "./files";
import jsonFile from "./json-file";
import type {
  RuntimeBinanceCooldownLogEntry,
  RuntimeBinanceHealthSnapshot,
} from "./logs";

const MAX_LOG_ENTRIES = 500;

/** Reads normalized cooldown incidents from persistent storage. */
async function readLogs(): Promise<RuntimeBinanceCooldownLogEntry[]> {
  if (!(await fs.pathExists(storageFiles.prod.logs.binanceCooldowns))) {
    return [];
  }
  const raw = await fs
    .readJSON(storageFiles.prod.logs.binanceCooldowns)
    .catch(() => []);
  return Array.isArray(raw) ? (raw as RuntimeBinanceCooldownLogEntry[]) : [];
}

/** Converts a persisted incident into the coordinator's active gate shape. */
function toCooldownState(
  incident: RuntimeBinanceCooldownLogEntry,
): BinanceCooldownState {
  return {
    endpoint: incident.endpoint,
    kind: incident.kind,
    reason: incident.reason,
    retryAt: incident.end,
    startedAt: incident.t,
    ...(incident.banEnd ? { exchangeRetryAt: incident.banEnd } : {}),
    ...(incident.settle ? { settleMs: incident.settle } : {}),
  };
}

const persistence: BinanceCooldownPersistence = {
  async readLatest() {
    const latest = (await readLogs()).at(-1);
    return latest ? toCooldownState(latest) : null;
  },

  async record(params) {
    let saved!: RuntimeBinanceCooldownLogEntry;
    await jsonFile.update.atomic<RuntimeBinanceCooldownLogEntry[]>(
      storageFiles.prod.logs.binanceCooldowns,
      (raw) => {
        const current = Array.isArray(raw)
          ? (raw as RuntimeBinanceCooldownLogEntry[])
          : [];
        const latest = current.at(-1);
        const continuous = latest && latest.end > params.detectedAt;
        saved = continuous
          ? {
              ...latest,
              code: params.code ?? latest.code,
              end: Math.max(latest.end, params.state.retryAt),
              endpoint: params.descriptor.endpoint,
              kind: params.descriptor.kind,
              occurrences: latest.occurrences + 1,
              reason: params.state.reason,
              status: params.status ?? latest.status,
              ...(params.state.exchangeRetryAt
                ? {
                    banEnd: Math.max(
                      latest.banEnd ?? 0,
                      params.state.exchangeRetryAt,
                    ),
                  }
                : {}),
              ...(params.state.settleMs
                ? { settle: params.state.settleMs }
                : {}),
            }
          : {
              code: params.code,
              end: params.state.retryAt,
              endpoint: params.descriptor.endpoint,
              id: `binance-cooldown-${params.detectedAt}-${Math.random()
                .toString(36)
                .slice(2, 10)}`,
              kind: params.descriptor.kind,
              occurrences: 1,
              reason: params.state.reason,
              status: params.status,
              t: params.detectedAt,
              ...(params.state.exchangeRetryAt
                ? { banEnd: params.state.exchangeRetryAt }
                : {}),
              ...(params.state.settleMs
                ? { settle: params.state.settleMs }
                : {}),
            };

        return [
          ...(continuous ? current.slice(0, -1) : current),
          saved,
        ].slice(-MAX_LOG_ENTRIES);
      },
    );
    return toCooldownState(saved);
  },

  async reset(now) {
    await jsonFile.update.atomic<RuntimeBinanceCooldownLogEntry[]>(
      storageFiles.prod.logs.binanceCooldowns,
      (raw) => {
        const current = Array.isArray(raw)
          ? (raw as RuntimeBinanceCooldownLogEntry[])
          : [];
        return current.map((incident) =>
          incident.end > now ? { ...incident, end: now } : incident,
        );
      },
    );
  },
};

/** Installs persistent cooldown coordination for the current server process. */
function install(): void {
  binanceRequestCoordinator.persistence.use(persistence);
}

/** Reads current Binance health and recent incident history. */
async function readSnapshot(
  options: { limit?: number } = {},
): Promise<RuntimeBinanceHealthSnapshot> {
  install();
  const [current, logs] = await Promise.all([
    binanceRequestCoordinator.cooldown.refresh(),
    readLogs(),
  ]);
  const limit = Math.max(0, options.limit ?? 20);
  return {
    current,
    logs: logs.sort((left, right) => right.t - left.t).slice(0, limit),
  };
}

/** Ends the active persistent cooldown while retaining its incident history. */
async function reset(): Promise<RuntimeBinanceHealthSnapshot> {
  install();
  // PROD:BINANCE_MANUAL_COOLDOWN_RESET
  await binanceRequestCoordinator.cooldown.reset();
  return readSnapshot();
}

const runtimeBinanceHealth = {
  coordinator: {
    install,
  },
  snapshot: {
    read: readSnapshot,
  },
  reset,
  storage: {
    readLogs,
  },
} as const;

export default runtimeBinanceHealth;
export { runtimeBinanceHealth };
