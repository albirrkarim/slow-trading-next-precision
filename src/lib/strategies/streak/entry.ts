import tradingEntry from "@/lib/system/trading/entry";
import lateEntryVPointDrift from "@/lib/system/trading/late-entry-vpoint-drift";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import type {
  RuntimeContext,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";

import pair from "../shared/pair";
import pairEntry from "../shared/entry";
import type { PairLegMeta } from "../shared/pair";
import streakState from "./state";

/** Any still-open leg of one pair — the survivor a reopen anchors against. */
function openLegOf(
  context: RuntimeContext,
  pairId: string,
): Position | undefined {
  return context.state.openPositions.find(
    (position) =>
      !position.closed &&
      pair.meta.ofPosition(position)?.pairId === pairId,
  );
}

/**
 * The re-entry anchor (STREAK FAQ 7/8): the NEWEST confirmed vPoint after
 * the surviving leg's entry that the empty role has not used for an entry.
 * A point another role consumed — e.g. the sibling averaged there — still
 * qualifies; only the exact `"<accountSlug>:<ROLE>"` marker blocks.
 */
function newestUnusedAnchor(
  context: RuntimeContext,
  symbol: string,
  accountSlug: string,
  role: "MAIN" | "COUNTER",
  sibling: Position,
): VolatilityPoint | undefined {
  const marker = pair.roleMarker(accountSlug, role);
  const points = context.state.vPointsMap[symbol.toUpperCase()] ?? [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.t < sibling.opened.t) break;
    if (!vpoints.usage.has(point, marker)) return point;
  }
  return undefined;
}

/**
 * `streak` entry producer — two candidate sources in order:
 *
 * 1. Role re-entries (STREAK:ROLE_REOPEN): every recorded empty role whose
 *    sibling still opens gets a candidate in the direction OPPOSITE the
 *    survivor, anchored at the newest unused vPoint, stamped
 *    `reopen: true` with a role-scoped `vPointUsage` marker. The normal
 *    entry guards still apply — the late-entry drift check runs here for
 *    the empty-slot reason and again at execution on the freshest mark.
 * 2. Fresh pairs via the shared pair producer — a symbol whose pair fully
 *    closed becomes eligible for a new MAIN+COUNTER pair (FAQ 10).
 */
async function find(
  context: RuntimeContext,
): Promise<RuntimeEntryCandidate[]> {
  const state = streakState.read(context);
  const candidates: RuntimeEntryCandidate[] = [];

  for (const record of Object.values(state.roles)) {
    const sibling = openLegOf(context, record.pairId);
    if (!sibling) {
      // Both legs are gone — no survivor to derive the role's direction;
      // the fresh-pair path re-enters the symbol normally.
      delete state.roles[record.pairId];
      continue;
    }

    const direction = pair.opposite(sibling.direction);
    const anchor = newestUnusedAnchor(
      context,
      record.symbol,
      record.accountSlug,
      record.role,
      sibling,
    );
    if (!anchor) {
      record.reason = "waiting for a confirmed unused vPoint";
      continue;
    }

    const drift = lateEntryVPointDrift.evaluate({
      currentPrice:
        context.state.markPriceMap[record.symbol.toUpperCase()]?.price,
      direction,
      enabled: context.helper.getAccountConfig(record.accountSlug)
        .lateEntryVPointPriceDriftEnabled,
      vPointPrice: anchor.p,
    });
    if (drift.blocked) {
      record.reason = `entry blocked: ${drift.reason ?? "price drifted from anchor"}`;
      continue;
    }

    const signal = tradingEntry.recommendation.make(anchor);
    const meta: PairLegMeta = {
      entryLegs: "BOTH",
      pairId: record.pairId,
      reopen: true,
      role: record.role,
    };
    delete record.reason;
    candidates.push({
      type: "entry",
      accountSlug: record.accountSlug,
      direction,
      entrySignal: {
        ...signal,
        message: `streak reopen ${record.role} → ${direction} at ${anchor.l}[${anchor.lvl}]`,
        symbol: record.symbol,
      },
      message: `STREAK re-entry ${record.role} ${direction} anchored at ` +
        `${anchor.l}[${anchor.lvl}] ${anchor.p}`,
      strategy: meta,
      symbol: record.symbol.toUpperCase(),
      vPointUsage: [pair.roleMarker(record.accountSlug, record.role)],
    });
  }

  candidates.push(...(await pairEntry.findPairs(context)));
  return candidates;
}

const streakEntry = {
  find,
} as const;

export default streakEntry;
