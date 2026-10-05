import {
    enabledAccountsOf,
    minEquityOf,
} from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import type { BacktestLeaderboardEntry } from "@/lib/dev/backtestPrecision/leaderboards";


/** ms -> compact human string. */
export function msToHuman(ms?: number) {
    if (!ms || ms <= 0) return "0s";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    const days = Math.floor(hr / 24);
    return `${days}d ${hr % 24}h`;
}

export function formatPct(value: number | undefined, fraction = false) {
    if (value == null || Number.isNaN(value)) return "-";
    const pct = fraction ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
}

export function formatNumber(value: number | undefined) {
    if (value == null || Number.isNaN(value)) return "-";
    return value.toFixed(2);
}

export function formatUsdt(value: number | undefined) {
    if (value == null || Number.isNaN(value)) return "-";
    return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`;
}

const JAKARTA_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
});

function jakartaTimeParts(t: number) {
    const parts = JAKARTA_TIME_FORMATTER.formatToParts(new Date(t));
    const get = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "";
    return {
        day: get("day"),
        hour: get("hour"),
        minute: get("minute"),
        month: get("month"),
        year: get("year"),
    };
}

/** WIB "02 Oct 07:32" — 24h clock; year appended only when it differs. */
export function formatTime(t?: number) {
    if (!t) return "-";
    const { day, hour, minute, month, year } = jakartaTimeParts(t);
    const yearSuffix = year === jakartaTimeParts(Date.now()).year
        ? ""
        : ` ${year}`;
    return `${day} ${month}${yearSuffix} ${hour}:${minute}`;
}

const JAKARTA_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "2-digit",
});

/**
 * Resolved window of a saved config — "01 Jan 24 → 04 Dec 24" (WIB dates)
 * when explicit startTime/endTime are persisted, else undefined. Explicit
 * bounds override the named `range`, so the window is shown under any label.
 */
export function formatRangeWindow(config: unknown): string | undefined {
    const c = config as
        | { endTime?: number; startTime?: number }
        | undefined;
    if (
        typeof c?.startTime !== "number" ||
        typeof c?.endTime !== "number" ||
        !Number.isFinite(c.startTime) ||
        !Number.isFinite(c.endTime) ||
        c.endTime <= c.startTime
    ) {
        return undefined;
    }
    const start = JAKARTA_DATE_FORMATTER.format(new Date(c.startTime));
    const end = JAKARTA_DATE_FORMATTER.format(new Date(c.endTime));
    return `${start} → ${end}`;
}

/** Min-equity cell: "[name $x] + [name $y] = $total" over enabled accounts. */
export function formatMinEquity(
    entry: Pick<BacktestLeaderboardEntry, "backtestConfig">,
): string {
    const accounts = enabledAccountsOf(entry);
    if (!accounts.length) return "-";
    const parts = accounts.map(
        (account) =>
            `[${account.name || account.slug}]$${Math.round(Number(account.sandbox?.initialBalanceUSDT) || 0)}`,
    );
    return `${parts.join(" + ")} = $${Math.round(minEquityOf(entry) ?? 0)}`;
}

/**
 * Deterministic label → color so same-label rows share a category color
 * regardless of sort order or filtering: the string hashes straight into a
 * hue, and fixed saturation/lightness keep every category readable against
 * the table surface.
 */
export function labelGroupColor(label: string): string {
    let hue = 0;
    for (const char of label) {
        hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
    }
    return `hsl(${hue}, 70%, 55%)`;
}

/** Red-green translucent gradient for cell shading relative to a column range. */
export function getGradientColor(
    value: number | undefined,
    min = 0,
    max = 1,
    invert = false,
): string {
    if (value == null || Number.isNaN(value)) return "inherit";
    if (max === min) {
        return invert ? "rgba(255, 50, 50, 0.18)" : "rgba(50, 255, 100, 0.18)";
    }
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const r = invert ? 1 - ratio : ratio;
    const red = Math.round(255 * (1 - r));
    const green = Math.round(255 * r);
    return `rgba(${red}, ${green}, 100, 0.18)`;
}
