/** Displays a ratio as a percentage, preserving unavailable denominators. */
const pct = (value: number | undefined): string =>
    value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

export default pct;
