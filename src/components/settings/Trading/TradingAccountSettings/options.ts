import type { RuntimeAccountTradingConfig } from "@/lib/system/runtime";

export const ENTRY_LEGS_OPTIONS = [
    { label: "Both", value: "BOTH" },
    { label: "Main", value: "MAIN" },
    { label: "Counter", value: "COUNTER" },
] satisfies {
    label: string;
    value: NonNullable<RuntimeAccountTradingConfig["entryLegs"]>;
}[];
