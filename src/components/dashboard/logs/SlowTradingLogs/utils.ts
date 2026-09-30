export const DELETE_ALL_ID = "__delete_all__";

export function formatTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

export function formatUsdt(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return `$${value.toFixed(2)}`;
}

export function formatConfigValue(value: unknown) {
  if (value === undefined) {
    return "—";
  }
  if (value === null || typeof value !== "object") {
    return String(value);
  }

  return JSON.stringify(value);
}
