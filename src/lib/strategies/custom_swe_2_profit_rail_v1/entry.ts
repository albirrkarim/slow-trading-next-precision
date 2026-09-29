import tradingEntry from "@/lib/system/trading/entry";
import lateEntryVPointDrift from "@/lib/system/trading/late-entry-vpoint-drift";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";
import type {
  RuntimeContext,
  RuntimeEntryCandidate,
} from "@/lib/precision/types";

import pair from "../shared/pair";
import pairEntry from "../shared/entry";
import type { PairLegMeta } from "../shared/pair";
import profitRailState from "./state";

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
 * The re-entry anchor: the NEWEST confirmed vPoint after the surviving
 * leg's entry that the empty role has not used for an entry **and** that
 * sits inside the account's `minEntryAbsLevel`/`maxEntryAbsLevel` band.
 * Out-of-band points are skipped — a shallow-band harvester must not
 * re-enter at a deep anchor (that silently turned level-bounded accounts
 * into deep-wave holders); a deep-band cover account must not re-enter on
 * noise levels either. A point another role consumed still qualifies;
 * only the exact `"<accountSlug>:<ROLE>"` marker blocks.
 */
function newestUnusedAnchor(
  context: RuntimeContext,
  symbol: string,
  accountSlug: string,
  role: "MAIN" | "COUNTER",
  sibling: Position,
  trading: RuntimeAccountTradingConfig,
): VolatilityPoint | undefined {
  const marker = pair.roleMarker(accountSlug, role);
  const points = context.state.vPointsMap[symbol.toUpperCase()] ?? [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.t < sibling.opened.t) break;
    if (
      tradingEntry.threshold.contains(
        point.lvl,
        trading.minEntryAbsLevel,
        trading.maxEntryAbsLevel,
      ) &&
      !vpoints.usage.has(point, marker)
    ) {
      return point;
    }
  }
  return undefined;
}

/**
 * `custom_swe_2_profit_rail_v1` entry producer — two candidate sources in
 * order:
 *
 * 1. Role re-entries: every recorded empty role whose sibling still opens
 *    gets a candidate in the direction OPPOSITE the survivor, anchored at
 *    the newest unused **in-band** vPoint, stamped `reopen: true` with a
 *    role-scoped `vPointUsage` marker. Normal entry guards still apply —
 *    the late-entry drift check runs here for the empty-slot reason and
 *    again at execution on the freshest mark.
 * 2. Fresh pairs via the shared pair producer — a symbol whose pair fully
 *    closed becomes eligible for a new MAIN+COUNTER pair.
 */
async function find(
  context: RuntimeContext,
): Promise<RuntimeEntryCandidate[]> {
  const state = profitRailState.read(context);
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
    const accountTrading = context.helper.getAccountConfig(
      record.accountSlug,
    );
    const anchor = newestUnusedAnchor(
      context,
      record.symbol,
      record.accountSlug,
      record.role,
      sibling,
      accountTrading,
    );
    if (!anchor) {
      record.reason =
        "waiting for a confirmed unused vPoint inside the entry level band";
      continue;
    }

    const drift = lateEntryVPointDrift.evaluate({
      currentPrice:
        context.state.markPriceMap[record.symbol.toUpperCase()]?.price,
      direction,
      enabled: accountTrading.lateEntryVPointPriceDriftEnabled,
      limitPct: accountTrading.lateEntryVPointPriceDriftPct,
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
        message: `profit-rail reopen ${record.role} → ${direction} at ${anchor.l}[${anchor.lvl}]`,
        symbol: record.symbol,
      },
      message: `PROFIT_RAIL re-entry ${record.role} ${direction} anchored at ` +
        `${anchor.l}[${anchor.lvl}] ${anchor.p}`,
      strategy: meta,
      symbol: record.symbol.toUpperCase(),
      vPointUsage: [pair.roleMarker(record.accountSlug, record.role)],
    });
  }

  candidates.push(...(await pairEntry.findPairs(context)));
  return candidates;
}

const profitRailEntry = {
  find,
} as const;

export default profitRailEntry;
