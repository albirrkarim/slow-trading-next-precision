export type NumericFilterOperator = "lt" | "lte" | "eq" | "gte" | "gt";

/** Numeric comparisons shared by trade and dataset filtering. */
const numericFilter = {
  operators: {
    lt: { label: "<", test: (a: number, b: number) => a < b },
    lte: { label: "≤", test: (a: number, b: number) => a <= b },
    eq: { label: "=", test: (a: number, b: number) => a === b },
    gte: { label: "≥", test: (a: number, b: number) => a >= b },
    gt: { label: ">", test: (a: number, b: number) => a > b },
  },
} as const;

export default numericFilter;
