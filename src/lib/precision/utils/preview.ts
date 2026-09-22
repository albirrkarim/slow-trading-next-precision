import type { RuntimeEngineState } from "../types";

const WIB_OFFSET_HOURS = 7;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Formats epoch millis as `22 Sep 2026 07:41` in the given UTC offset. */
function formatDateTime(t: number, utcOffsetHours: number): string {
  const d = new Date(t + utcOffsetHours * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}`;
}

/**
 * Builds a readable multi-line preview of the data a runtime engine is
 * starting with — vPoint coverage per symbol, open positions, and account
 * balances. Intended for the engine's startup log so boot seeds and replay
 * inputs can be eyeballed at a glance.
 */
function state(runtimeState: RuntimeEngineState): string {
  const t = runtimeState.currentTime;
  const lines: string[] = [
    `  time   ${formatDateTime(t, WIB_OFFSET_HOURS)} WIB · ${formatDateTime(t, 0)} UTC · ${t}`,
    `  mode   ${runtimeState.mode}`,
    "",
  ];

  const vPointEntries = Object.entries(runtimeState.vPointsMap).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const symbolWidth = Math.max(0, ...vPointEntries.map(([symbol]) => symbol.length));
  lines.push(`  vPoints (${vPointEntries.length} symbols)`);
  for (const [symbol, points] of vPointEntries) {
    const first = points.at(0)?.id ?? "-";
    const last = points.at(-1)?.id ?? "-";
    lines.push(
      `    ${symbol.padEnd(symbolWidth)} (${String(points.length).padStart(3)})  ${first} → ${last}`,
    );
  }
  lines.push("");

  const positions = runtimeState.openPositions;
  lines.push(`  openPositions (${positions.length})`);
  for (const position of positions) {
    lines.push(
      `    #${position.account} ${position.symbol} ${position.direction} lvl ${position.strategy.averaging.entryLevel} margin $${position.exposure.marginUsdt.toFixed(2)}`,
    );
  }
  lines.push("");

  const balanceSlugs = Object.keys(runtimeState.balance).sort();
  lines.push(`  balances (${balanceSlugs.length})`);
  for (const slug of balanceSlugs) {
    const balance = runtimeState.balance[slug];
    lines.push(
      `    #${slug} total $${balance.total.toFixed(2)} free $${balance.available.toFixed(2)} locked $${balance.locked.toFixed(2)} reserved $${balance.reserved.toFixed(2)}`,
    );
  }

  return lines.join("\n");
}

/** Grouped runtime preview formatters. */
const preview = {
  state,
};

export default preview;
