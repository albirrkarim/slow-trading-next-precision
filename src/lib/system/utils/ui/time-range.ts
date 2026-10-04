/** Formats a millisecond timestamp for a `datetime-local` input value. */
export function msToLocalInput(ms?: number) {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a `datetime-local` input value back to milliseconds. */
export function localInputToMs(value: string) {
    return value ? new Date(value).getTime() : undefined;
}

/** Resolves a named range (e.g. "3month") into an absolute [startTime, endTime] window. */
export function calculateTimeRange(range: string): {
    startTime: number;
    endTime: number;
} {
    const now = Date.now();
    const day = 1000 * 60 * 60 * 24;

    const map: Record<string, number> = {
        "1month": day * 30,
        "2month": day * 60,
        "3month": day * 90,
        "6month": day * 180,
        "1year": day * 365,
        "2year": day * 365 * 2,
        "3year": day * 365 * 3,
        "4year": day * 365 * 4,
        "5year": day * 365 * 5,
        "6year": day * 365 * 6,
        "7year": day * 365 * 7,
        "8year": day * 365 * 8,
        "9year": day * 365 * 9,
        "10year": day * 365 * 10,
    };

    const duration = map[range] ?? 0;
    const endTime = now;
    const startTime = now - duration;
    return { startTime, endTime };
}
