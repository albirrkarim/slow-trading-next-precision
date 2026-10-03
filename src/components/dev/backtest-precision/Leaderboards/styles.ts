import type { Theme } from "@mui/material/styles";

/** Theme-aware table header background shared by the leaderboard tables. */
export const TABLE_HEAD_SX = {
    backgroundColor: (theme: Theme) =>
        theme.palette.mode === "dark"
            ? theme.palette.grey[800]
            : theme.palette.grey[300],
} as const;

/** Compact bordered-cell table layout shared by the leaderboard tables. */
export const TABLE_GRID_SX = {
    borderCollapse: "collapse",
    "& td, & th": {
        borderBottom: (theme: Theme) => `1px solid ${theme.palette.divider}`,
        borderRight: (theme: Theme) => `1px solid ${theme.palette.divider}`,
        m: 0,
        p: 0.5,
        textAlign: "center",
        whiteSpace: "nowrap",
    },
    // Cell-level tint keeps the per-column gradient readable under hover.
    "& tbody tr:hover td": {
        boxShadow: (theme: Theme) =>
            theme.palette.mode === "dark"
                ? "inset 0 0 0 999px rgba(255,255,255,0.08)"
                : "inset 0 0 0 999px rgba(0,0,0,0.05)",
    },
} as const;
