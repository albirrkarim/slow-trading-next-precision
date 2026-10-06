import type { Position, PositionCloseReason } from "@/lib/system/trading";
import type {
  RuntimeContext,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";

/** Role labels pair strategies stamp on each leg's position metadata. */
export type PairRole = "MAIN" | "COUNTER";

/**
 * Slim persisted snapshot of a pair leg that closed while its sibling
 * stays open — the strategy-state copy that keeps the closed role visible
 * in the paired UI until the pair fully closes.
 */
export interface PairClosedLeg {
  role: PairRole;
  account: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  opened: { t: number; price: number };
  closed: {
    t: number;
    price?: number;
    reason?: PositionCloseReason;
    message?: string;
  };
  pnl: { usdt: number; pct: number };
  marginUsdt: number;
}

/** Per-account leg selection (`trading.entryLegs`). */
export type EntryLegs = "MAIN" | "COUNTER" | "BOTH";

/**
 * Strategy-owned payload a pair producer stamps on each leg decision. The
 * shared entry commit copies it verbatim onto `position.strategy.logic`, so
 * every leg keeps its pair identity through persistence, guard checks, and
 * strategy bookkeeping.
 */
export interface PairLegMeta {
  /** Stable id shared by every leg of one pair — `<accountSlug>:<SYMBOL>:<vPointId>`. */
  pairId: string;
  /** Which role this leg plays inside the pair. */
  role: PairRole;
  /** The account's `entryLegs` selection captured at entry time. */
  entryLegs: EntryLegs;
  /** Marks a leg produced by a role re-entry rather than the initial pair. */
  reopen?: boolean;
}

/** Pair-level payload stamped on `RuntimePairEntryDecision.strategy`. */
export interface PairMeta {
  pairId: string;
  entryLegs: EntryLegs;
}

function isRole(value: unknown): value is PairRole {
  return value === "MAIN" || value === "COUNTER";
}

function isEntryLegs(value: unknown): value is EntryLegs {
  return value === "MAIN" || value === "COUNTER" || value === "BOTH";
}

/**
 * Validates an opaque `decision.strategy`/`position.strategy.logic` payload
 * into a `PairLegMeta` — returns undefined for foreign or malformed shapes
 * so non-pair positions pass through untouched.
 */
function readLegMeta(raw: unknown): PairLegMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const meta = raw as Partial<PairLegMeta>;
  if (typeof meta.pairId !== "string" || !meta.pairId) return undefined;
  if (!isRole(meta.role)) return undefined;
  return {
    pairId: meta.pairId,
    role: meta.role,
    entryLegs: isEntryLegs(meta.entryLegs) ? meta.entryLegs : "BOTH",
    ...(meta.reopen === true ? { reopen: true } : {}),
  };
}

/** Reads the pair leg metadata recorded on a position at commit time. */
function ofPosition(position: Position): PairLegMeta | undefined {
  return readLegMeta(position.strategy?.logic);
}

/** Reads the pair leg metadata stamped on an entry-like decision. */
function ofDecision(decision: RuntimeEntryCandidate): PairLegMeta | undefined {
  return decision.type === "pairEntry" ? undefined : readLegMeta(decision.strategy);
}

/** Builds the pair id one entry's legs share. */
function buildId(
  accountSlug: string,
  symbol: string,
  vPointId: string,
): string {
  return `${accountSlug}:${symbol.toUpperCase()}:${vPointId}`;
}

/** vPoint usage marker scoped to one role — `"<accountSlug>:<ROLE>"`. */
function roleMarker(accountSlug: string, role: PairRole): string {
  return `${accountSlug}:${role}`;
}

/** The opposite trade direction. */
function opposite(direction: "LONG" | "SHORT"): "LONG" | "SHORT" {
  return direction === "LONG" ? "SHORT" : "LONG";
}

/**
 * Captures the display fields of a just-closed pair leg into the slim
 * `PairClosedLeg` record persisted under the strategy state slot.
 */
function snapshotClosedLeg(
  position: Position,
  role: PairRole,
): PairClosedLeg {
  return {
    account: position.account,
    closed: {
      message: position.closed?.message,
      price: position.closed?.price,
      reason: position.closed?.reason,
      t: position.closed?.t ?? 0,
    },
    direction: position.direction,
    marginUsdt: position.exposure.marginUsdt,
    opened: { price: position.opened.price, t: position.opened.t },
    pnl: {
      pct: position.pnl.netPct ?? 0,
      usdt: position.pnl.netUsdt ?? 0,
    },
    role,
    symbol: position.symbol,
  };
}

/** The direction a role plays against the pair's signal direction. */
function roleDirection(
  signalDirection: "LONG" | "SHORT",
  role: PairRole,
): "LONG" | "SHORT" {
  return role === "MAIN" ? signalDirection : opposite(signalDirection);
}

/**
 * Finds the still-open counterpart leg of one pair position — the leg
 * sharing `meta.pairId` with the opposite role.
 */
function findSibling(
  context: RuntimeContext,
  meta: PairLegMeta,
): Position | undefined {
  return context.state.openPositions.find((candidate) => {
    if (candidate.closed) return false;
    const other = ofPosition(candidate);
    return (
      other !== undefined &&
      other.pairId === meta.pairId &&
      other.role !== meta.role
    );
  });
}

/**
 * Unique worker key for capacity accounting: pair legs collapse to their
 * `pairId` so one pair counts as ONE worker; unpaired positions keep a
 * unique per-position key.
 */
function workerKey(position: Position): string {
  const meta = ofPosition(position);
  return meta
    ? `pair:${meta.pairId}`
    : `pos:${position.account}:${position.symbol}:${position.opened.t}`;
}

/** Strategy slugs whose entry producers stamp MAIN/COUNTER pair meta. */
const PAIR_SLUGS: ReadonlySet<string> = new Set([
  "both",
  "streak",
  "streak_with_feature_gate",
]);

/**
 * Pair strategies that keep a pending empty-role re-entry after a leg
 * closes — they render the paired board for every `entryLegs` selection
 * and get streak-style empty slots/diagnostics.
 */
const REENTRY_SLUGS: ReadonlySet<string> = new Set([
  "streak",
  "streak_with_feature_gate",
]);

/** Whether a strategy slug produces pair legs. */
function isPairSlug(slug?: string): boolean {
  return PAIR_SLUGS.has(slug ?? "");
}

/** Whether a pair strategy slug keeps pending empty-role re-entries. */
function isReentrySlug(slug?: string): boolean {
  return REENTRY_SLUGS.has(slug ?? "");
}

/**
 * Pair mode is per-account: a pair strategy selected and the account's
 * `entryLegs` is `"BOTH"` (the default) — `MAIN`/`COUNTER` is the
 * account's one-way selection, trading only that role leg. The type
 * predicate narrows `config.strategy` to a defined slug for callers that
 * render the paired view.
 */
function isPairMode(config: {
  strategy?: string;
  entryLegs?: string;
}): config is { strategy: string } {
  return (
    isPairSlug(config.strategy) &&
    (config.entryLegs ?? "BOTH") === "BOTH"
  );
}

/**
 * Legs funded per worker — pair mode funds 2 legs (MAIN + COUNTER),
 * a `MAIN`/`COUNTER` one-way account funds 1. Per spec §B one worker is
 * one pair: its worker count is not doubled, but the entry margin and
 * reserved averaging ladder are funded for both legs.
 */
function legsPerWorker(config: {
  strategy?: string;
  entryLegs?: string;
}): 1 | 2 {
  return isPairMode(config) ? 2 : 1;
}

/**
 * Collapses pair legs into one representative per pair — feeding
 * `tradingEntry.findDecisions` a view where a pair counts as one open
 * position keeps `maxOpenPositions` pair-aware without changing the shared
 * producer (the representative keeps its symbol, so the same-symbol block
 * still vetoes a second pair on that coin).
 */
function collapse(positions: Position[]): Position[] {
  const seen = new Set<string>();
  return positions.filter((position) => {
    if (position.closed) return true;
    const meta = ofPosition(position);
    if (!meta) return true;
    const key = meta.pairId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const pair = {
  buildId,
  closedLeg: {
    snapshot: snapshotClosedLeg,
  },
  collapse,
  direction: roleDirection,
  findSibling,
  isPairMode,
  isPairSlug,
  isReentrySlug,
  legsPerWorker,
  meta: {
    ofDecision,
    ofPosition,
  },
  opposite,
  roleMarker,
  workerKey,
} as const;

export default pair;
