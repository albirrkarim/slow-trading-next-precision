import fs from "fs-extra";
import path from "path";

import jsonFile from "@/lib/system/storage/json-file";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

import type {
  BacktestArtifactManifest,
  BacktestBalanceSnapshot,
} from "./backtest-precision-types";

/** Default number of records written per part file. */
const DEFAULT_CHUNK_SIZE = 500;

const partFileName = (index: number) =>
  `part-${String(index).padStart(6, "0")}.json`;

interface KeyedBuffer<T> {
  buffer: T[];
  part: number;
}

const newKeyedBuffer = <T>(): KeyedBuffer<T> => ({ buffer: [], part: 0 });

/** Flushes one buffer to the next part file when it reaches the chunk size. */
async function pushChunked<T>(
  dir: string,
  slot: KeyedBuffer<T>,
  record: T,
  chunkSize: number,
): Promise<void> {
  slot.buffer.push(record);
  if (slot.buffer.length >= chunkSize) {
    await flushSlot(dir, slot);
  }
}

/** Writes whatever remains in the buffer as the next part file. */
async function flushSlot<T>(
  dir: string,
  slot: KeyedBuffer<T>,
): Promise<void> {
  if (slot.buffer.length === 0) return;
  const file = path.join(dir, partFileName(slot.part));
  await jsonFile.write.atomic(file, slot.buffer);
  slot.part += 1;
  slot.buffer = [];
}

/** Lists part files of one artifact directory in write order. */
async function listPartFiles(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const names = (await fs.readdir(dir)).filter((name) =>
    /^part-\d+\.json$/.test(name),
  );
  return names.sort().map((name) => path.join(dir, name));
}

/** Concatenates every part file of one artifact directory. */
async function readParts<T>(dir: string): Promise<T[]> {
  const files = await listPartFiles(dir);
  const out: T[] = [];
  for (const file of files) {
    const part = (await fs.readJSON(file)) as T[];
    for (const record of part) out.push(record);
  }
  return out;
}

async function listChildDirs(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((e) => e.name);
}

const positionsDir = (dir: string) => path.join(dir, "positions");
const vpointsDir = (dir: string, symbol?: string) =>
  symbol ? path.join(dir, "vpoints", symbol) : path.join(dir, "vpoints");
const snapshotsDir = (dir: string, slug?: string) =>
  slug ? path.join(dir, "snapshots", slug) : path.join(dir, "snapshots");

/**
 * Incremental artifact writer for a running backtest. Buffers records in
 * memory and flushes a JSON part file every `chunkSize` records so the run
 * never retains the full result set.
 */
function createSpool(dir: string, chunkSize = DEFAULT_CHUNK_SIZE) {
  const positions = newKeyedBuffer<Position>();
  const vpoints = new Map<string, KeyedBuffer<VolatilityPoint>>();
  const snapshots = new Map<string, KeyedBuffer<BacktestBalanceSnapshot>>();

  const slotFor = <T>(map: Map<string, KeyedBuffer<T>>, key: string) => {
    let slot = map.get(key);
    if (!slot) {
      slot = newKeyedBuffer<T>();
      map.set(key, slot);
    }
    return slot;
  };

  return {
    pushPosition: (position: Position) =>
      pushChunked(positionsDir(dir), positions, position, chunkSize),
    pushVPoint: (symbol: string, point: VolatilityPoint) =>
      pushChunked(
        vpointsDir(dir, symbol),
        slotFor(vpoints, symbol),
        point,
        chunkSize,
      ),
    /**
     * Appends one account snapshot. Keeps the in-memory capture semantics:
     * a repeat of the last timestamp replaces the buffered record instead
     * of appending. Once a part is flushed a same-t duplicate can still
     * slip through at the boundary — readers sort by `t` so the later
     * record wins downstream.
     */
    pushSnapshot: (slug: string, snapshot: BacktestBalanceSnapshot) => {
      const slot = slotFor(snapshots, slug);
      const last = slot.buffer[slot.buffer.length - 1];
      if (last && last.t === snapshot.t) {
        slot.buffer[slot.buffer.length - 1] = snapshot;
        return Promise.resolve();
      }
      return pushChunked(snapshotsDir(dir, slug), slot, snapshot, chunkSize);
    },
    /** Flushes every pending buffer and reports the written part counts. */
    async finalize(): Promise<BacktestArtifactManifest> {
      await flushSlot(positionsDir(dir), positions);
      const vpointsParts: Record<string, number> = {};
      for (const [symbol, slot] of vpoints) {
        await flushSlot(vpointsDir(dir, symbol), slot);
        vpointsParts[symbol] = slot.part;
      }
      const snapshotParts: Record<string, number> = {};
      for (const [slug, slot] of snapshots) {
        await flushSlot(snapshotsDir(dir, slug), slot);
        snapshotParts[slug] = slot.part;
      }
      return {
        positions: positions.part,
        vpoints: vpointsParts,
        snapshots: snapshotParts,
      };
    },
  };
}

const backtestArtifacts = {
  spool: {
    create: createSpool,
  },
  read: {
    /** All positions (closed history followed by still-open), in order. */
    positions: (dir: string) => readParts<Position>(positionsDir(dir)),
    /** One symbol's points when `symbol` is given, else the whole map. */
    async vpoints(
      dir: string,
      symbol?: string,
    ): Promise<VolatilityPoint[] | Record<string, VolatilityPoint[]>> {
      if (symbol) {
        return readParts<VolatilityPoint>(vpointsDir(dir, symbol));
      }
      const symbols = await listChildDirs(vpointsDir(dir));
      const map: Record<string, VolatilityPoint[]> = {};
      for (const name of symbols) {
        map[name] = await readParts<VolatilityPoint>(vpointsDir(dir, name));
      }
      return map;
    },
    /** One account's timeline when `slug` is given, else all timelines. */
    async snapshots(
      dir: string,
      slug?: string,
    ): Promise<
      BacktestBalanceSnapshot[] | Record<string, BacktestBalanceSnapshot[]>
    > {
      if (slug) {
        return readParts<BacktestBalanceSnapshot>(snapshotsDir(dir, slug));
      }
      const slugs = await listChildDirs(snapshotsDir(dir));
      const map: Record<string, BacktestBalanceSnapshot[]> = {};
      for (const name of slugs) {
        map[name] = await readParts<BacktestBalanceSnapshot>(
          snapshotsDir(dir, name),
        );
      }
      return map;
    },
  },
} as const;

export default backtestArtifacts;
