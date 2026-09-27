import type { RuntimeHistoryPosition } from "@/lib/system/trading";

import pair from "./pair";
import type { PairClosedLeg, PairLegMeta, PairRole } from "./pair";

/** One slot of a paired-open-positions row. */
export type PairBoardSlot =
  | { kind: "open"; position: RuntimeHistoryPosition }
  | { kind: "closed"; leg: PairClosedLeg }
  | { kind: "empty"; reason?: string };

/** One pair row: both role slots plus the combined net PnL. */
export interface PairBoardRow {
  key: string;
  account: string;
  symbol: string;
  pairId?: string;
  netUsdt: number;
  slots: Record<PairRole, PairBoardSlot>;
}

interface PairBoardParams {
  /** Active pair strategy — selects how a missing role slot is explained. */
  slug: "both" | "streak";
  /** Raw `state.strategy` payload; only the matching-version slot is read. */
  strategyState: unknown;
  openPositions: RuntimeHistoryPosition[];
  /** Participating account slugs (accountFilter + enabled already applied). */
  accounts: string[];
  /** Management symbols shown on the board. */
  symbols: string[];
}

/** The strategy slot fields the board reads, tolerant of missing keys. */
interface PairBoardSlotState {
  closed?: Record<string, PairClosedLeg>;
  roles?: Record<string, { role?: PairRole; reason?: string }>;
}

const ROLES: PairRole[] = ["MAIN", "COUNTER"];

/**
 * Reads the persisted strategy slot when its version matches `slug`;
 * anything else — foreign slot, malformed shape, nothing persisted — is
 * tolerated as an empty record.
 */
function readSlot(
  slug: PairBoardParams["slug"],
  strategyState: unknown,
): PairBoardSlotState {
  if (
    !strategyState ||
    typeof strategyState !== "object" ||
    (strategyState as { v?: unknown }).v !== slug
  ) {
    return {};
  }
  return strategyState as PairBoardSlotState;
}

/**
 * Fills the missing role of a half-open pair — the closed-leg snapshot
 * (`both`), the pending re-entry reason (`streak`), or an explanatory
 * empty slot.
 */
function emptySlot(
  params: PairBoardParams,
  slot: PairBoardSlotState,
  meta: PairLegMeta,
  role: PairRole,
): PairBoardSlot {
  if (params.slug === "both") {
    const closed = slot.closed?.[meta.pairId];
    if (closed && closed.role === role) {
      return { kind: "closed", leg: closed };
    }
    return {
      kind: "empty",
      reason:
        meta.entryLegs !== "BOTH"
          ? `Not traded (entryLegs ${meta.entryLegs}).`
          : "Closed.",
    };
  }
  return {
    kind: "empty",
    reason:
      slot.roles?.[meta.pairId]?.reason ??
      "Waiting for re-entry at the next confirmed unused vPoint.",
  };
}

/**
 * Builds the paired-open-positions view model: one row per open pair
 * (missing roles stay visible), every position without pair meta in
 * `unpaired`, and — for `streak` — one empty row per configured
 * account × symbol that has no pair.
 */
function build(params: PairBoardParams): {
  rows: PairBoardRow[];
  unpaired: RuntimeHistoryPosition[];
} {
  const slot = readSlot(params.slug, params.strategyState);
  const unpaired: RuntimeHistoryPosition[] = [];
  const groups = new Map<string, { meta: PairLegMeta; position: RuntimeHistoryPosition }[]>();

  for (const position of params.openPositions) {
    if (position.closed) continue;
    const meta = pair.meta.ofPosition(position);
    if (!meta) {
      unpaired.push(position);
      continue;
    }
    const key = `${position.account}:${position.symbol.toUpperCase()}`;
    const group = groups.get(key) ?? [];
    group.push({ meta, position });
    groups.set(key, group);
  }

  const rows: { row: PairBoardRow; openedT: number }[] = [];
  const covered = new Set<string>();
  for (const legs of groups.values()) {
    const first = legs[0];
    const slots = {} as Record<PairRole, PairBoardSlot>;
    let netUsdt = 0;
    let openedT = Infinity;
    for (const role of ROLES) {
      const open = legs.find((leg) => leg.meta.role === role);
      if (open) {
        slots[role] = { kind: "open", position: open.position };
        netUsdt += Number(open.position.pnl.netUsdt) || 0;
        openedT = Math.min(openedT, open.position.opened.t);
      } else {
        slots[role] = emptySlot(params, slot, first.meta, role);
        if (slots[role].kind === "closed") {
          netUsdt += Number(slots[role].leg.pnl.usdt) || 0;
        }
      }
    }
    covered.add(`${first.position.account}:${first.position.symbol.toUpperCase()}`);
    rows.push({
      openedT,
      row: {
        account: first.position.account,
        key: first.meta.pairId,
        netUsdt,
        pairId: first.meta.pairId,
        slots,
        symbol: first.position.symbol.toUpperCase(),
      },
    });
  }
  rows.sort((left, right) => left.openedT - right.openedT);

  // STREAK spec C.1: the open-position list always shows every configured
  // coin; a coin with no pair renders both roles empty.
  const emptyRows: PairBoardRow[] = [];
  if (params.slug === "streak") {
    for (const account of params.accounts) {
      for (const rawSymbol of params.symbols) {
        const symbol = String(rawSymbol).toUpperCase();
        if (!symbol || covered.has(`${account}:${symbol}`)) continue;
        emptyRows.push({
          account,
          key: `${account}:${symbol}`,
          netUsdt: 0,
          slots: {
            COUNTER: { kind: "empty" },
            MAIN: { kind: "empty" },
          },
          symbol,
        });
      }
    }
    emptyRows.sort((left, right) => left.key.localeCompare(right.key));
  }

  return {
    rows: [...rows.map(({ row }) => row), ...emptyRows],
    unpaired,
  };
}

const pairBoard = {
  build,
} as const;

export default pairBoard;
