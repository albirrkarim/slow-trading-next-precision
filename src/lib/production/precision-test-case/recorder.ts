import path from "path";

import fs from "fs-extra";

import { FILES } from "@/components/storage";
import { resolvePersistentStorageRoot } from "@/lib/persistent-storage-root";
import type { RuntimeEngineState } from "@/lib/precision/types";
import slowTradingShared from "@/lib/slowTrading/shared";
import slowTradingStorage from "@/lib/slowTrading/storage";
import jsonFile from "@/lib/slowTrading/storage/json-file";

import type {
  PrecisionTestCase,
  PrecisionTestCaseFileSummary,
  PrecisionTestCaseMode,
  PrecisionTestCaseRecordingState,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";

const RECORDING_DIRECTORY = path.join(
  resolvePersistentStorageRoot(),
  "dev",
  "precision-test-case",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finiteTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Date.now();
}

function cloneConfigWithoutCredentials(
  config: PrecisionTestCase["config"],
): PrecisionTestCase["config"] {
  // A test case is safe to move into backtest tooling; never persist exchange
  // secrets even though the production runtime config contains them.
  const safeConfig = clone(config);
  safeConfig.accounts = safeConfig.accounts.map((account) => ({
    ...account,
    credentials: { apiKey: "", apiSecret: "" },
  }));

  safeConfig.runtime.mcp = { tokens: [] };

  return safeConfig;
}

/**
 * Bounds each symbol's persisted vPoints while preserving replay dependencies.
 *
 * A point is retained when it is among the latest 10 points, occurred at or
 * after the earliest open position's entry time, or is explicitly referenced
 * by an open position's entry/intermediate vPoints:
 *
 * `keep = latest10 || point.t >= earliestOpenPositionTime || openPositionReferencesPoint`
 *
 * Chronological source order is preserved.
 */
function snapshotVPoints(
  vPointsMap: RuntimeEngineState["vPointsMap"],
  openPositions: RuntimeEngineState["openPositions"],
): RuntimeEngineState["vPointsMap"] {
  return Object.fromEntries(
    Object.entries(vPointsMap).map(([symbol, points]) => {
      const positions = openPositions.filter(
        (position) =>
          !position.closed &&
          position.symbol.toUpperCase() === symbol.toUpperCase(),
      );
      const earliestOpenT = positions.length
        ? Math.min(...positions.map((position) => position.opened.t))
        : undefined;
      const referencedIds = new Set(
        positions.flatMap((position) => [
          position.opened.vPoint.id,
          ...(position.vPoints ?? []).map((point) => point.id),
        ]),
      );
      const retained = points.filter(
        (point, index) =>
          index >= Math.max(0, points.length - 10) ||
          (earliestOpenT !== undefined && point.t >= earliestOpenT) ||
          referencedIds.has(point.id),
      );
      return [symbol, clone(retained)];
    }),
  );
}

/**
 * Computes the vPoint delta between the initial snapshot and the end state:
 * points whose id is absent from the initial map, plus points present under
 * the same id whose serialized content changed (e.g. usage markers gained
 * during the window). Symbols with no delta are omitted. Order preserved.
 */
function diffVPoints(
  initial: RuntimeEngineState["vPointsMap"],
  endMap: RuntimeEngineState["vPointsMap"],
): RuntimeEngineState["vPointsMap"] {
  return Object.fromEntries(
    Object.entries(endMap)
      .map(([symbol, points]) => {
        const beforeById = new Map(
          (initial[symbol] ?? []).map((point) => [point.id, point]),
        );
        const delta = points.filter((point) => {
          const before = beforeById.get(point.id);
          return (
            !before || JSON.stringify(before) !== JSON.stringify(point)
          );
        });
        return [symbol, clone(delta)] as const;
      })
      .filter(([, delta]) => delta.length > 0),
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats a test-case filename timestamp as `dd-mm-yyyy-hh-mm` in UTC. */
function formatFileTimestamp(time: number): string {
  const date = new Date(time);
  return [
    pad(date.getUTCDate()),
    pad(date.getUTCMonth() + 1),
    date.getUTCFullYear(),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join("-");
}

function getFileName(
  mode: PrecisionTestCaseMode,
  startTime: number,
  endTime: number | undefined,
): string {
  return `${mode}-${formatFileTimestamp(startTime)}-${
    endTime === undefined ? "undefined" : formatFileTimestamp(endTime)
  }.json`;
}

const COMPLETED_FILE_PATTERN =
  /^(live|sandbox)-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.json$/;

/** Validates a basename strictly matching the completed test-case format. */
function assertCompletedFileName(fileName: string): void {
  if (
    typeof fileName !== "string" ||
    path.basename(fileName) !== fileName ||
    !COMPLETED_FILE_PATTERN.test(fileName)
  ) {
    throw new Error(`Invalid precision test case file name: ${fileName}`);
  }
}

/**
 * Lists completed test-case files newest-first. Pending recordings, unrelated
 * files, and malformed JSON payloads are skipped.
 */
async function listFiles(): Promise<PrecisionTestCaseFileSummary[]> {
  if (!(await fs.pathExists(RECORDING_DIRECTORY))) {
    return [];
  }

  const entries = await fs.readdir(RECORDING_DIRECTORY);
  const summaries = await Promise.all(
    entries
      .filter((entry) => COMPLETED_FILE_PATTERN.test(entry))
      .map(async (fileName) => {
        const filePath = path.join(RECORDING_DIRECTORY, fileName);
        try {
          const stats = await fs.stat(filePath);
          if (!stats.isFile()) {
            return null;
          }
          const value = (await fs.readJSON(filePath)) as Partial<
            Pick<
              PrecisionTestCase,
              "endState" | "endTime" | "startTime" | "tradeHistory"
            >
          > | null;
          if (
            !value ||
            typeof value !== "object" ||
            !Number.isFinite(value.startTime) ||
            !Number.isFinite(value.endTime) ||
            !Array.isArray(value.tradeHistory) ||
            !value.endState ||
            typeof value.endState !== "object" ||
            Array.isArray(value.endState)
          ) {
            return null;
          }
          const mode: PrecisionTestCaseMode = fileName.startsWith("live")
            ? "live"
            : "sandbox";
          return {
            endTime: value.endTime as number,
            fileName,
            mode,
            sizeBytes: stats.size,
            startTime: value.startTime as number,
            tradeHistoryLength: value.tradeHistory.length,
          };
        } catch {
          return null;
        }
      }),
  );

  return summaries
    .filter((summary): summary is PrecisionTestCaseFileSummary =>
      Boolean(summary),
    )
    .sort((left, right) => right.endTime - left.endTime);
}

/** Removes exactly one completed test-case file after strict validation. */
async function removeFile(
  fileName: string,
): Promise<{ deleted: true; fileName: string }> {
  assertCompletedFileName(fileName);
  const filePath = path.join(RECORDING_DIRECTORY, fileName);
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`Precision test case file not found: ${fileName}`);
  }

  await fs.unlink(filePath);
  return { deleted: true, fileName };
}

async function readRecordingState(): Promise<PrecisionTestCaseRecordingState> {
  if (!(await fs.pathExists(FILES.slow.precisionTestCase))) {
    return { recording: false };
  }

  const value = await fs.readJSON(FILES.slow.precisionTestCase);
  if (!value || typeof value !== "object") {
    return { recording: false };
  }

  return value as PrecisionTestCaseRecordingState;
}

async function writeRecordingState(
  state: PrecisionTestCaseRecordingState,
): Promise<void> {
  await jsonFile.write.atomic(FILES.slow.precisionTestCase, state);
}

async function getStatus(
  state?: RuntimeEngineState,
): Promise<PrecisionTestCaseStatus> {
  const recordingState = await readRecordingState();
  if (!recordingState.recording || !recordingState.mode) {
    return { recording: false, tradeHistoryLength: 0 };
  }

  let tradeHistoryLength = 0;
  if (state && recordingState.startTime !== undefined) {
    const endTime = Math.max(
      recordingState.startTime,
      finiteTime(state.currentTime),
    );
    tradeHistoryLength = (
      await slowTradingStorage.history.readRange({
        endTime,
        mode: recordingState.mode,
        startTime: recordingState.startTime,
      })
    ).length;
  }

  return {
    fileName: recordingState.fileName,
    mode: recordingState.mode,
    recording: true,
    startTime: recordingState.startTime,
    tradeHistoryLength,
  };
}

async function start(
  state: RuntimeEngineState,
): Promise<PrecisionTestCaseStatus> {
  // PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
  const recordingState = await readRecordingState();
  if (recordingState.recording) {
    throw new Error("A precision production test case is already recording.");
  }

  if (state.mode !== "live" && state.mode !== "sandbox") {
    throw new Error(
      "Precision test cases can only be recorded in production mode.",
    );
  }

  if (!Number.isFinite(state.currentTime)) {
    throw new Error(
      "Production runtime is not ready for a precision test case: currentTime is not finite.",
    );
  }

  const symbols = slowTradingShared.symbols.buildExecution(
    state.config.management.symbols,
  );
  const missingVPoints = symbols.filter(
    (symbol) => !Object.hasOwn(state.vPointsMap, symbol),
  );
  const missingMarkPrice = symbols.filter((symbol) => {
    const price = state.markPriceMap[symbol]?.price;
    return !Number.isFinite(price) || price <= 0;
  });
  if (missingVPoints.length > 0 || missingMarkPrice.length > 0) {
    throw new Error(
      "Production runtime is not ready for a precision test case." +
        (missingVPoints.length > 0
          ? ` Missing vPoints: ${missingVPoints.join(", ")}.`
          : "") +
        (missingMarkPrice.length > 0
          ? ` Missing mark price: ${missingMarkPrice.join(", ")}.`
          : ""),
    );
  }

  const startTime = state.currentTime;
  const fileName = getFileName(state.mode, startTime, undefined);
  const testCase: PrecisionTestCase = {
    config: cloneConfigWithoutCredentials(state.config),
    initialState: {
      balance: clone(state.balance),
      openPositions: clone(state.openPositions),
      vPointsMap: snapshotVPoints(state.vPointsMap, state.openPositions),
    },
    startTime,
    tradeHistory: [],
  };
  const filePath = path.join(RECORDING_DIRECTORY, fileName);

  await fs.ensureDir(RECORDING_DIRECTORY);
  await jsonFile.write.atomic(filePath, testCase);

  try {
    await writeRecordingState({
      fileName,
      mode: state.mode,
      recording: true,
      startTime,
    });
  } catch (error) {
    await fs.remove(filePath).catch(() => undefined);
    throw error;
  }

  return getStatus(state);
}

async function end(state: RuntimeEngineState): Promise<PrecisionTestCaseResult> {
  const recordingState = await readRecordingState();
  if (
    !recordingState.recording ||
    !recordingState.mode ||
    recordingState.startTime === undefined ||
    !recordingState.fileName
  ) {
    throw new Error("No precision production test case is recording.");
  }

  const startTime = recordingState.startTime;
  const endTime = Math.max(startTime, finiteTime(state.currentTime));
  const pendingPath = path.join(RECORDING_DIRECTORY, recordingState.fileName);
  if (!(await fs.pathExists(pendingPath))) {
    throw new Error(
      `Recording test case file is missing: ${recordingState.fileName}`,
    );
  }

  const initialTestCase = (await fs.readJSON(pendingPath)) as PrecisionTestCase;
  const tradeHistory = await slowTradingStorage.history.readRange({
    endTime,
    mode: recordingState.mode,
    startTime,
  });
  const testCase: PrecisionTestCase = {
    ...initialTestCase,
    endState: {
      balance: clone(state.balance),
      openPositions: clone(state.openPositions),
      vPointsMap: diffVPoints(
        initialTestCase.initialState.vPointsMap,
        state.vPointsMap,
      ),
    },
    endTime,
    tradeHistory: clone(tradeHistory),
  };
  const fileName = getFileName(recordingState.mode, startTime, endTime);
  const filePath = path.join(RECORDING_DIRECTORY, fileName);

  // PROD:PRODUCTION_TEST_CASE
  await jsonFile.write.atomic(filePath, testCase);
  await writeRecordingState({ recording: false });
  await fs.remove(pendingPath);

  return { fileName, path: filePath, testCase };
}

const recorder = {
  end,
  files: {
    list: listFiles,
    remove: removeFile,
  },
  getStatus,
  start,
} as const;

export default recorder;
export { recorder };
export type {
  PrecisionTestCase,
  PrecisionTestCaseFileSummary,
  PrecisionTestCaseMode,
  PrecisionTestCaseRecordingState,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";
