import { afterEach, describe, expect, it } from "vitest";

import {
    applyColumnVisibility,
    HIDDEN_COLUMNS_STORAGE_KEY,
    readHiddenColumns,
    writeHiddenColumns,
} from "@/components/dev/backtest-precision/Leaderboards/column-visibility";
import type { HeaderGroup } from "@/components/dev/backtest-precision/Leaderboards/columns";

const GROUPS: HeaderGroup[] = [
    { id: "label", label: "Label" },
    { id: "leaderboard.gainPct", label: "Gain" },
    {
        children: [
            { id: "g.avg", label: "avg" },
            { id: "g.max", label: "max" },
        ],
        id: "grouped",
        label: "Grouped",
    },
];

describe("leaderboard column visibility", () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).localStorage;
    });

    it("drops hidden children and collapses a fully-hidden group", () => {
        expect(
            applyColumnVisibility(GROUPS, new Set(["g.avg"]))[2]?.children,
        ).toHaveLength(1);
        // Both children hidden → the group itself disappears.
        const filtered = applyColumnVisibility(
            GROUPS,
            new Set(["g.avg", "g.max"]),
        );
        expect(filtered.map((g) => g.id)).toEqual([
            "label",
            "leaderboard.gainPct",
        ]);
        // Ungrouped columns hide by their own id.
        expect(
            applyColumnVisibility(GROUPS, new Set(["label"])).map((g) => g.id),
        ).toEqual(["leaderboard.gainPct", "grouped"]);
    });

    it("round-trips the hidden set through localStorage", () => {
        const store: Record<string, string> = {};
        (globalThis as Record<string, unknown>).localStorage = {
            getItem: (k: string) => store[k] ?? null,
            removeItem: (k: string) => {
                delete store[k];
            },
            setItem: (k: string, v: string) => {
                store[k] = v;
            },
        };
        expect(readHiddenColumns()).toEqual(new Set());
        writeHiddenColumns(new Set(["g.max"]));
        expect(readHiddenColumns()).toEqual(new Set(["g.max"]));
        // Empty set clears the key so defaults stay clean.
        writeHiddenColumns(new Set());
        expect(store[HIDDEN_COLUMNS_STORAGE_KEY]).toBeUndefined();
        store[HIDDEN_COLUMNS_STORAGE_KEY] = "{bad json";
        expect(readHiddenColumns()).toEqual(new Set());
    });
});
