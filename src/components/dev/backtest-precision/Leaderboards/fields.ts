import { strategyChipLabel } from "@/components/dashboard/navigation/NavbarStrategyChip";
import { LOWER_IS_BETTER } from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import {
    formatNumber,
    formatPct,
    formatUsdt,
    msToHuman,
} from "./format";

const FRACTION_FIELDS = new Set([
    "leaderboard.maxPortfolioDrawdown.avg",
    "leaderboard.maxPortfolioDrawdown.max",
    "leaderboard.maxFloatingDrawdown.avg",
    "leaderboard.maxFloatingDrawdown.max",
]);

const SCORE_FIELDS = new Set([
    "leaderboard.balanceTradesScore",
    "leaderboard.capitalEfficiency.hrScore",
    "leaderboard.capitalEfficiency.trScore",
    "leaderboard.capitalEfficiency.score",
]);

const USD_FIELDS = new Set([
    "leaderboard.maxFloatingDrawdownUsdt.avg",
    "leaderboard.maxFloatingDrawdownUsdt.max",
]);

const DURATION_FIELDS = new Set([
    "leaderboard.emptyBalance.min",
    "leaderboard.emptyBalance.avg",
    "leaderboard.emptyBalance.max",
]);

const PLAIN_FIELDS = new Set([
    "leaderboard.positionsClosed",
    "leaderboard.sharpeRatio",
    "leaderboard.tradesPerDay",
]);

/** Detector param cell: the saved override as a percent, "env" when unset/zero. */
function formatVolatilityParam(value: unknown): string {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? `${numeric}%` : "env";
}

/** Text leaf columns: field id -> cell formatter. Sorting uses the raw leaf. */
export const TEXT_FIELDS = new Map<string, (value: unknown) => string>([
    [
        "backtestConfig.range",
        (value) =>
            typeof value === "string" && value.trim() ? value : "-",
    ],
    [
        "backtestConfig.settings.management.strategy",
        (value) =>
            strategyChipLabel(
                typeof value === "string" ? value : undefined,
            ),
    ],
    [
        "backtestConfig.settings.management.volatilityThreshold",
        formatVolatilityParam,
    ],
    [
        "backtestConfig.settings.management.volatilityRetracePct",
        formatVolatilityParam,
    ],
]);

/** Columns where lower is better (gradient inverted). */
export const INVERT_FIELDS = LOWER_IS_BETTER;

export function formatCell(fieldId: string, value: unknown): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    if (DURATION_FIELDS.has(fieldId)) return msToHuman(value);
    if (FRACTION_FIELDS.has(fieldId)) return formatPct(value, true);
    if (USD_FIELDS.has(fieldId)) return formatUsdt(value);
    if (SCORE_FIELDS.has(fieldId)) return formatPct(value, true);
    if (PLAIN_FIELDS.has(fieldId)) return formatNumber(value);
    return formatPct(value);
}
