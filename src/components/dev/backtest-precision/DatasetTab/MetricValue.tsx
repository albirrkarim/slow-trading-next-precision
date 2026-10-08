"use client";

import type { ReactNode } from "react";

import HintTooltip from "@/components/ui/HintTooltip";

/** Dataset-metrics wording for the shared dashed hint — `detail` is the tooltip text. */
export default function MetricValue({ children, detail }: { children: ReactNode; detail: string }) {
  return <HintTooltip title={detail}>{children}</HintTooltip>;
}
