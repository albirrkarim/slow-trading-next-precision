import moment from "moment-timezone";

/** Formats a millisecond timestamp exactly like the legacy datasets helper. */
function formatReadable(
  time?: number,
  format: string = "DD_MMM_YYYY_HH_mm",
): string {
  return moment(time).format(format);
}

const systemTime = {
  formatReadable,
} as const;

export default systemTime;
export { systemTime };
