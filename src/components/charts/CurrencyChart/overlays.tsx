"use client";

import type {
    MarkerHoverState,
    TrajectoryHoverState,
} from "./types";

export function BetterCloseOverlay({
    lineX,
    label,
}: {
    lineX: number | null;
    label: string | null;
}) {
    if (lineX === null || !label) return null;
    return (
        <>
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: lineX,
                    transform: "translateX(-50%)",
                    width: 0,
                    borderLeft: "3px dashed rgba(255, 87, 34, 0.98)",
                    pointerEvents: "none",
                    zIndex: 9,
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
                }}
                title={`Better close at ${label}`}
            />
            <div
                style={{
                    position: "absolute",
                    top: 10,
                    left: lineX,
                    transform: "translateX(-50%)",
                    pointerEvents: "none",
                    zIndex: 10,
                    background: "rgba(255, 87, 34, 0.16)",
                    border: "1px solid rgba(255, 87, 34, 0.65)",
                    color: "#ff7043",
                    borderRadius: 999,
                    padding: "3px 9px",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
                }}
                title={`Better close at ${label}`}
            >
                Better close
            </div>
        </>
    );
}

export function TrajectoryHoverTooltip({
    hover,
}: {
    hover: TrajectoryHoverState;
}) {
    return (
        <div
            style={{
                position: "absolute",
                left: hover.x,
                top: hover.y,
                zIndex: 20,
                maxWidth: 320,
                pointerEvents: "none",
                background: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e5e7eb",
                fontSize: 12,
                lineHeight: 1.45,
                boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
            }}
        >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                AIM {hover.scenario}.{hover.pointIndex}
            </div>
            <div>
                {hover.point.timeHuman}
            </div>
            <div>
                Price: {hover.point.price}
            </div>
            <div>
                Entry PnL: {hover.pnlPercent === null
                    ? "—"
                    : `${hover.pnlPercent > 0 ? "+" : ""}${hover.pnlPercent.toFixed(2)}%`}
            </div>
            <div style={{ marginTop: 6 }}>
                {hover.point.message}
            </div>
        </div>
    );
}

export function MarkerHoverTooltip({
    hover,
}: {
    hover: MarkerHoverState;
}) {
    return (
        <div
            style={{
                position: "absolute",
                left: hover.x,
                top: hover.y,
                zIndex: 20,
                maxWidth: 320,
                pointerEvents: "none",
                background: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e5e7eb",
                fontSize: 12,
                lineHeight: 1.45,
                boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                whiteSpace: "pre-wrap",
            }}
        >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {hover.title}
            </div>
            <div>{hover.text}</div>
        </div>
    );
}
