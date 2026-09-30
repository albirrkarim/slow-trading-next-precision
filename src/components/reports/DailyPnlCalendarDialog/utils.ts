export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toUtcDayKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function parseUtcDayKey(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function formatMonthTitle(day: string): string {
  return parseUtcDayKey(day).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatSignedUsdt(value: number): string {
  return `${value >= 0 ? "+" : ""}$${value.toFixed(2)}`;
}

export function formatSignedPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Formats a currency value to fit inside a narrow mobile calendar cell. */
export function formatCompactSignedUsdt(value: number): string {
  const absoluteValue = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const scale = absoluteValue >= 1_000_000
    ? { divisor: 1_000_000, suffix: "m" }
    : absoluteValue >= 1_000
      ? { divisor: 1_000, suffix: "k" }
      : { divisor: 1, suffix: "" };
  const scaledValue = absoluteValue / scale.divisor;
  const maximumDecimals = scale.divisor > 1
    ? 1
    : absoluteValue >= 100
      ? 0
      : absoluteValue >= 10
        ? 1
        : 2;
  const formattedValue = Number(scaledValue.toFixed(maximumDecimals)).toString();

  return `${sign}$${formattedValue}${scale.suffix}`;
}

/** Formats a percentage with only the precision useful in a mobile cell. */
export function formatCompactSignedPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  const absoluteValue = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const maximumDecimals = absoluteValue >= 100 ? 0 : 1;
  const formattedValue = Number(absoluteValue.toFixed(maximumDecimals)).toString();

  return `${sign}${formattedValue}%`;
}

export function formatWinRate(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatSharpe(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(2);
}

export function getDaysInUtcMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return 0;
  }

  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatUsdt(value: number | null): string {
  return value !== null ? `$${value.toFixed(2)}` : "—";
}
