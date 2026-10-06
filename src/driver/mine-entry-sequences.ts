/**
 * Mining driver — extracts every |lvl|===1 entry candidate from a precision
 * backtest cache's vPoint artifacts, classifies whether the same-side pivot
 * sequence escalated to |lvl| >= ESCALATION_DEPTH, reconstructs the feature
 * store as-of the entry moment (same pure functions the runtime calls), and
 * writes the case dataset to storage/analysis/case1/data.json. A threshold
 * scan over the extracted features reports which signal best separates
 * "sequence escalates" from "entry was safe".
 *
 *   npx tsx -r tsconfig-paths/register src/driver/mine-entry-sequences.ts [cacheDir]
 */
import fs from "fs-extra";

import backtestArtifacts from "@/lib/dev/backtestPrecision/backtest/artifacts";
import {
  computePriceNormalized,
  replayPriceNormalizedHistory,
} from "@/lib/features/price-normalized";
import type { FeatureHistoryPoint } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ESCALATION_DEPTH = 4;
const EXTENDED_HISTORY_MS = 30 * DAY_MS;

const cacheDir =
  process.argv[2] ??
  "storage/cache/backtest-precision/4de397e90a9f0b4934430f1c6d8cd7023d4a69b6447b5a57701a5bbe4ef8d44c";
const outPath =
  process.argv[3] ?? "storage/analysis/case1/data.json";

/** Basic stats over a value-change trail (empty → all undefined). */
function trailStats(trail: FeatureHistoryPoint[]) {
  if (trail.length === 0) {
    return { count: 0, max: undefined, mean: undefined, min: undefined, slope: undefined };
  }
  const values = trail.map((p) => p.p);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: trail.length,
    max: Math.max(...values),
    mean: sum / values.length,
    min: Math.min(...values),
    slope: values[values.length - 1] - values[0],
  };
}

/** Rebuilds the coin feature slice exactly as `features.update` would at `now`. */
function coinFeaturesAt(now: number, points: VolatilityPoint[]) {
  return {
    priceNormalized: {
      current: computePriceNormalized({ now, points }),
      history: replayPriceNormalizedHistory({ now, points }),
      // Extended trail for mining only — runtime persists 10d; the study
      // gets 30d so long-window excursions stay visible.
      historyExtended: replayPriceNormalizedHistory({
        historyWindowMs: EXTENDED_HISTORY_MS,
        now,
        points,
      }),
    },
  };
}

interface CaseRecord {
  symbol: string;
  t: number;
  direction: "LONG" | "SHORT";
  entryLevel: number;
  entrySequence: VolatilityPoint[];
  prevSequence: VolatilityPoint[];
  maxDepth: number;
  escalated: boolean;
  truncated: boolean;
  featureOnEntry: {
    coins: Record<string, ReturnType<typeof coinFeaturesAt>>;
    shared: Record<string, number>;
  };
  featureExtras: Record<string, number | undefined>;
}

async function main() {
  const vPointsMap = (await backtestArtifacts.read.vpoints(
    cacheDir,
  )) as Record<string, VolatilityPoint[]>;
  const btcPoints = (vPointsMap.BTC ?? []).slice().sort((a, b) => a.t - b.t);

  const records: CaseRecord[] = [];
  for (const [symbol, raw] of Object.entries(vPointsMap)) {
    if (symbol === "BTC") continue;
    const points = raw.slice().sort((a, b) => a.t - b.t);
    let btcIdx = 0;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (Math.abs(point.lvl) !== 1) continue;
      const t = point.t;

      // Forward same-side run — the sequence this entry joins.
      const run: VolatilityPoint[] = [];
      let j = i;
      while (j < points.length && points[j].l === point.l) {
        run.push(points[j]);
        j += 1;
      }
      const maxDepth = Math.max(...run.map((p) => Math.abs(p.lvl)));

      // The opposite-side run immediately before — how deep the move we
      // just turned from had gone.
      const prev: VolatilityPoint[] = [];
      let k = i - 1;
      while (k >= 0 && points[k].l !== point.l) {
        prev.unshift(points[k]);
        k -= 1;
      }

      while (btcIdx < btcPoints.length && btcPoints[btcIdx].t <= t) {
        btcIdx += 1;
      }
      const btcUpto = btcPoints.slice(0, btcIdx);

      const coin = coinFeaturesAt(t, points.slice(0, i + 1));
      const btc = coinFeaturesAt(t, btcUpto);
      const trail5d = coin.priceNormalized.historyExtended.filter(
        (p) => p.t >= t - 5 * DAY_MS,
      );
      const btcTrail5d = btc.priceNormalized.historyExtended.filter(
        (p) => p.t >= t - 5 * DAY_MS,
      );
      const coin30 = trailStats(coin.priceNormalized.historyExtended);
      const btc30 = trailStats(btc.priceNormalized.historyExtended);
      const coin5 = trailStats(trail5d);
      const btc5 = trailStats(btcTrail5d);

      records.push({
        symbol,
        t,
        direction: point.l === "B" ? "LONG" : "SHORT",
        entryLevel: point.lvl,
        entrySequence: run,
        prevSequence: prev,
        maxDepth,
        escalated: maxDepth >= ESCALATION_DEPTH,
        truncated: j >= points.length,
        featureOnEntry: {
          coins: { [symbol]: coin, BTC: btc },
          shared: {},
        },
        featureExtras: {
          pivotPct: point.pct,
          hoursSincePrevPivot:
            i > 0 ? (t - points[i - 1].t) / HOUR_MS : undefined,
          prevOppositeDepth:
            prev.length > 0
              ? Math.max(...prev.map((p) => Math.abs(p.lvl)))
              : undefined,
          prevOppositeCount: prev.length || undefined,
          pn: coin.priceNormalized.current,
          pnMin5d: coin5.min,
          pnMax5d: coin5.max,
          pnMean5d: coin5.mean,
          pnChanges5d: coin5.count,
          pnMin30d: coin30.min,
          pnMax30d: coin30.max,
          pnMean30d: coin30.mean,
          pnSlope30d: coin30.slope,
          btcPn: btc.priceNormalized.current,
          btcPnMin5d: btc5.min,
          btcPnMax5d: btc5.max,
          btcPnMean5d: btc5.mean,
          btcPnMin30d: btc30.min,
          btcPnMax30d: btc30.max,
          btcPnMean30d: btc30.mean,
        },
      });
    }
  }

  await fs.ensureDir(outPath.slice(0, outPath.lastIndexOf("/")));
  await fs.writeJson(outPath, records);

  // ── Report ─────────────────────────────────────────────────────────
  const usable = records.filter((r) => !r.truncated);
  const escalated = usable.filter((r) => r.escalated);
  console.log(
    `\n${records.length} level-1 candidates (${usable.length} with known outcome); ` +
      `${escalated.length} escalated to |lvl|>=${ESCALATION_DEPTH} ` +
      `(${((100 * escalated.length) / Math.max(usable.length, 1)).toFixed(1)}%)`,
  );

  for (const direction of ["LONG", "SHORT"] as const) {
    const rows = usable.filter((r) => r.direction === direction);
    const bad = rows.filter((r) => r.escalated);
    console.log(
      `\n=== ${direction}: ${rows.length} entries, ${bad.length} escalated ` +
        `(${((100 * bad.length) / Math.max(rows.length, 1)).toFixed(1)}%) ===`,
    );
    reportSeparators(rows);
  }

  // Real-position collateral: which actual backtest entries would a rule hit.
  const positions = (await backtestArtifacts.read.positions(cacheDir)) as any[];
  const byVPoint = new Map(records.map((r) => [r.entrySequence[0]?.id, r]));
  const realEntries = positions
    .map((p) => ({ p, rec: byVPoint.get(p.opened?.vPoint?.id) }))
    .filter((x) => x.rec);
  console.log(`\n=== ${realEntries.length} real positions at level-1 ===`);
  for (const { p, rec } of realEntries) {
    console.log(
      `  ${rec!.symbol} ${rec!.direction} ${new Date(rec!.t).toISOString().slice(0, 16)} ` +
        `depth=${rec!.maxDepth} escalated=${rec!.escalated} pn=${rec!.featureExtras.pn?.toFixed(3)} ` +
        `net=${p.pnl?.netUsdt?.toFixed?.(2)}`,
    );
  }
}

type Row = CaseRecord;

/**
 * Sweeps every numeric extra × threshold × inequality direction and prints
 * rules ranked by escalations caught per good entry blocked.
 */
function reportSeparators(rows: Row[]) {
  const featureKeys = [
    "pn",
    "pnMin5d",
    "pnMax5d",
    "pnMean5d",
    "pnChanges5d",
    "pnMin30d",
    "pnMax30d",
    "pnMean30d",
    "pnSlope30d",
    "btcPn",
    "btcPnMin5d",
    "btcPnMax5d",
    "btcPnMean5d",
    "pivotPct",
    "hoursSincePrevPivot",
    "prevOppositeDepth",
    "prevOppositeCount",
  ];
  const escalated = rows.filter((r) => r.escalated);
  const good = rows.filter((r) => !r.escalated);

  const hits: {
    rule: string;
    badBlocked: number;
    goodBlocked: number;
  }[] = [];
  for (const key of featureKeys) {
    const vals = rows
      .map((r) => r.featureExtras[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (vals.length < 10) continue;
    const grid = Array.from(
      { length: 19 },
      (_, i) => vals[Math.floor(((i + 1) / 20) * (vals.length - 1))],
    );
    for (const thr of grid) {
      for (const op of ["<=", ">="] as const) {
        const test = (v?: number) =>
          v === undefined ? false : op === "<=" ? v <= thr : v >= thr;
        const badBlocked = escalated.filter((r) =>
          test(r.featureExtras[key]),
        ).length;
        const goodBlocked = good.filter((r) =>
          test(r.featureExtras[key]),
        ).length;
        if (badBlocked === 0) continue;
        hits.push({
          rule: `${key} ${op} ${thr.toFixed(3)}`,
          badBlocked,
          goodBlocked,
        });
      }
    }
  }
  hits.sort(
    (a, b) =>
      b.badBlocked / Math.max(b.goodBlocked, 1) -
        a.badBlocked / Math.max(a.goodBlocked, 1) || b.badBlocked - a.badBlocked,
  );
  console.log(
    `  base: ${escalated.length} bad / ${good.length} good | ` +
      `top separators (badCaught / goodBlocked):`,
  );
  for (const h of hits.slice(0, 12)) {
    console.log(
      `    ${h.rule.padEnd(32)} bad ${h.badBlocked}/${escalated.length} ` +
        `good ${h.goodBlocked}/${good.length}`,
    );
  }
}

void main();
