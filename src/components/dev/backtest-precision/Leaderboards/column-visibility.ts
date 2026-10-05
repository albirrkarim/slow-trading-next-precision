import type { HeaderGroup } from "./columns";

/**
 * localStorage key for the hidden leaderboard leaf-column id set.
 * Absent ids are visible, so columns added later show up by default.
 */
export const HIDDEN_COLUMNS_STORAGE_KEY =
    "backtest-precision:leaderboard-hidden-columns:v1";

/** Reads the persisted hidden leaf-column ids; malformed input resets to none. */
export function readHiddenColumns(): Set<string> {
    try {
        const raw = localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(
            Array.isArray(parsed)
                ? parsed.filter(
                      (id): id is string => typeof id === "string",
                  )
                : [],
        );
    } catch {
        return new Set();
    }
}

/** Persists the hidden leaf-column ids; an empty set removes the key. */
export function writeHiddenColumns(hidden: ReadonlySet<string>): void {
    try {
        if (hidden.size > 0) {
            localStorage.setItem(
                HIDDEN_COLUMNS_STORAGE_KEY,
                JSON.stringify([...hidden]),
            );
        } else {
            localStorage.removeItem(HIDDEN_COLUMNS_STORAGE_KEY);
        }
    } catch {
        /* storage unavailable */
    }
}

/**
 * Filters header groups down to visible leaf columns: hidden children drop
 * out of their group, a grouped column disappears once all its children are
 * hidden, and an ungrouped column hides by its own id.
 */
export function applyColumnVisibility(
    groups: HeaderGroup[],
    hidden: ReadonlySet<string>,
): HeaderGroup[] {
    return groups
        .map((group) =>
            group.children
                ? {
                      ...group,
                      children: group.children.filter(
                          (child) => !hidden.has(child.id),
                      ),
                  }
                : group,
        )
        .filter((group) =>
            group.children ? group.children.length > 0 : !hidden.has(group.id),
        );
}
