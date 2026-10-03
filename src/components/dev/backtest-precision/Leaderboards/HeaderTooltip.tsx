"use client";

import type { ReactElement } from "react";
import { Tooltip } from "@mui/material";

const headerTooltipSlotProps = {
    tooltip: {
        sx: {
            fontSize: "0.8rem",
            lineHeight: 1.45,
            maxWidth: 420,
            p: 1.1,
            whiteSpace: "pre-line",
        },
    },
} as const;

export function HeaderTooltip({
    children,
    title,
}: {
    children: ReactElement;
    title?: string;
}) {
    return (
        <Tooltip
            arrow
            placement="top"
            slotProps={headerTooltipSlotProps}
            title={title ?? ""}
        >
            {children}
        </Tooltip>
    );
}
