import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type { ActivePosition, AimMarkerSource } from "./types";

export const AVG_MARKER_COLOR = "#f57c00";

export function activePositionToMarkers(pos: ActivePosition | undefined): Marker[] {
    if (!pos) return [];

    const markers: Marker[] = [];
    const entryTime = pos.opened.t;
    const entryPrice = pos.opened.price;

    if (
        typeof entryTime === "number" &&
        Number.isFinite(entryTime) &&
        entryTime > 0 &&
        typeof entryPrice === "number" &&
        Number.isFinite(entryPrice) &&
        entryPrice > 0
    ) {
        const entryLabel = `ENTRY ${entryPrice}`;

        markers.push({
            time: Math.floor(entryTime / 1000) as any,
            position: "belowBar",
            color: "#2962FF",
            shape: "arrowUp",
            text: "ENTRY",
            price: entryPrice,
            tooltipTitle: entryLabel,
            tooltipText: [
                new Date(entryTime).toLocaleString(),
                `Price: ${entryPrice}`,
            ].join("\n"),
        });
    }

    const executions = pos.strategy.averaging.executions ?? [];
    for (const trigger of executions) {
        if (
            !(typeof trigger.t === "number" && Number.isFinite(trigger.t) && trigger.t > 0) ||
            !(typeof trigger?.price === "number" && Number.isFinite(trigger.price) && trigger.price > 0)
        ) {
            continue;
        }

        const increaseLabel = `AVG $${trigger.marginUsdt.toFixed(2)} @ ${trigger.price}`;

        markers.push({
            time: Math.floor(trigger.t / 1000) as any,
            position: "belowBar",
            color: AVG_MARKER_COLOR,
            shape: "circle",
            text: increaseLabel,
            price: trigger.price,
            tooltipTitle: increaseLabel,
            tooltipText: [
                new Date(trigger.t).toLocaleString(),
                `Price: ${trigger.price}`,
                typeof trigger.allocationPct === "number" && Number.isFinite(trigger.allocationPct)
                    ? `Multiplier: +${trigger.allocationPct}x`
                    : null,
                typeof trigger.projectedProfitPct === "number" &&
                    Number.isFinite(trigger.projectedProfitPct)
                    ? `Projected rescue: ${trigger.projectedProfitPct.toFixed(2)}%`
                    : null,
                typeof trigger.reservedMarginUsdt === "number" &&
                    Number.isFinite(trigger.reservedMarginUsdt)
                    ? `Reserved: $${trigger.reservedMarginUsdt.toFixed(2)} USDT`
                    : null,
                `Add margin: $${trigger.marginUsdt.toFixed(2)} USDT`,
            ]
                .filter(Boolean)
                .join("\n"),
        });
    }

    const reserveSteps = executions.length === 0
        ? pos.strategy.averaging.steps
        : [];
    for (const [index, step] of reserveSteps.entries()) {
        const stepPrice = step.usedPrice;

        if (
            step.status !== "USED" ||
            !(typeof step.usedAt === "number" && Number.isFinite(step.usedAt) && step.usedAt > 0) ||
            !(typeof stepPrice === "number" && Number.isFinite(stepPrice) && stepPrice > 0)
        ) {
            continue;
        }

        const label = `AVG L${step.level ?? index + 1}`;
        markers.push({
            time: Math.floor(step.usedAt / 1000) as any,
            position: "belowBar",
            color: AVG_MARKER_COLOR,
            shape: "circle",
            text: label,
            price: stepPrice,
            tooltipTitle: label,
            tooltipText: [
                new Date(step.usedAt).toLocaleString(),
                `Price: ${stepPrice}`,
                typeof step.marginUsdt === "number"
                    ? `Add margin: $${step.marginUsdt.toFixed(2)} USDT`
                    : null,
                typeof step.allocationPct === "number"
                    ? `Multiplier: +${step.allocationPct}x`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });
    }

    return markers;
}

export function aimPositionToMarkers(pos: AimMarkerSource): Marker[] {
    if (!pos) return [];

    const beginTimeMs = pos.beginTime;
    const beginPrice = pos.beginPrice;

    if (typeof beginTimeMs !== "number" || !Number.isFinite(beginTimeMs)) return [];

    const textPrice =
        typeof beginPrice === "number" && Number.isFinite(beginPrice)
            ? ` @ ${beginPrice}`
            : "";

    return [
        {
            time: Math.floor(beginTimeMs / 1000) as any,
            position: "belowBar",
            color: "#f9a825",
            shape: "arrowUp",
            text: `AIM START${textPrice}`,
        },
    ];
}
