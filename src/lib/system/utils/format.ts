import moment from "moment";

/**
 * Formats milliseconds into a human-readable duration like "2d 3h 4m".
 * Seconds are shown only when the duration is under a minute.
 */
function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "0s";

  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds && parts.length === 0) parts.push(`${seconds}s`);
  return parts.length ? parts.join(" ") : "0s";
}

/** Formats a millisecond timestamp with a moment pattern. */
function timeMsToReadable(
  timeMs?: number,
  format: string = "DD_MMM_YYYY_HH_mm",
): string {
  return moment(timeMs).format(format);
}

/**
 * Formats a millisecond timestamp for log/chart display like
 * "04 Aug 2026 19:55 UTC". Always UTC so it matches kline/chart times.
 */
function timeForLog(timeMs?: number): string {
  return moment.utc(timeMs).format("DD MMM YYYY HH:mm [UTC]");
}

/** Formats a vPoint ref for log display like "B_9b1 (lvl 3)". */
function vPointForLog(vPoint?: { id: string; lvl: number }): string {
  if (!vPoint) {
    return "-";
  }
  const short = vPoint.id.split("_").slice(0, 2).join("_");
  return `${short} (lvl ${vPoint.lvl})`;
}

const format = {
  duration: formatDuration,
  timeForLog,
  timeMsToReadable,
  vPointForLog,
} as const;

export default format;
