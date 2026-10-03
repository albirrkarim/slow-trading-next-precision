"use client";

import { Checkbox, FormControlLabel } from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import { startTransition } from "react";

export function ChartLegend({
  dataColors,
  dataKeys,
  effectiveShowTradeGroup,
  isolate,
  seriesNames,
  setShowTradeGroup,
  toggle,
  tradeGroups,
  visible,
}: {
  dataColors: string[];
  dataKeys: string[];
  effectiveShowTradeGroup: Record<string, boolean>;
  isolate: (key: string) => void;
  seriesNames: string[];
  setShowTradeGroup: Dispatch<SetStateAction<Record<string, boolean>>>;
  toggle: (key: string) => void;
  tradeGroups: string[];
  visible: Set<string>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, zIndex: "0!important" }}>
      {/* TRADE group toggles */}
      {tradeGroups.length > 0 && (
        <div
          style={{
            alignItems: "center",
            columnGap: 10,
            display: "flex",
            flexWrap: "wrap",
            rowGap: 2,
          }}
        >
          {tradeGroups.map((g) => (
            <FormControlLabel
              key={g}
              sx={{
                m: 0,
                minHeight: 26,
                "& .MuiFormControlLabel-label": {
                  fontSize: 12,
                  lineHeight: 1.2,
                },
              }}
              control={
                <Checkbox
                  checked={effectiveShowTradeGroup[g] ?? false}
                  onChange={(e) =>
                    startTransition(() =>
                      setShowTradeGroup((prev) => ({
                        ...prev,
                        [g]: e.target.checked,
                      }))
                    )
                  }
                  size="small"
                  sx={{
                    p: 0.375,
                    mr: 0.25,
                    "& .MuiSvgIcon-root": { fontSize: 16 },
                  }}
                />
              }
              label={g}
            />
          ))}
        </div>
      )}

      {/* Normal legend items */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {dataKeys.map((key, idx) => {
          const name = seriesNames[idx];
          const color = dataColors[idx % dataColors.length];
          const isVisible = visible.has(key);
          if (!name) return null;

          // Skip TRADE items from normal legend (they’re handled by group toggles)
          if (name.startsWith("TRADE ")) return null;

          if (name.startsWith("ENTRY ")) return null;

          return (
            <div
              key={key}
              onClick={() => toggle(key)}
              onDoubleClick={() => isolate(key)}
              style={{
                cursor: "pointer",
                display: "flex",
                gap: 6,
                alignItems: "center",
                opacity: isVisible ? 1 : 0.35,
                userSelect: "none",
              }}
              title={
                isVisible
                  ? `Hide ${name} (double-click to isolate)`
                  : `Show ${name}`
              }
            >
              <div
                style={{
                  width: 12,
                  height: 8,
                  background: color,
                  borderRadius: 2,
                }}
              />
              <div style={{ fontSize: 13 }}>{name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
