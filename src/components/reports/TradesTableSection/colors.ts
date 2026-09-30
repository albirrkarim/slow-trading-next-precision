import type { RangedValueColorRange } from "../RangedValueText";
import { DAY_MS } from "./format";

export const HOLD_DURATION_COLOR_RANGES: RangedValueColorRange[] = [
  {
    color: "success.main",
    max: DAY_MS,
  },
  {
    color: "warning.main",
    max: DAY_MS * 2,
    maxInclusive: true,
    min: DAY_MS,
  },
  {
    color: "error.main",
    min: DAY_MS * 2,
    minInclusive: false,
  },
];

export const RUN_UP_COLOR_RANGES: RangedValueColorRange[] = [
  {
    color: "error.main",
    max: 1,
  },
  {
    color: "warning.main",
    max: 5,
    min: 1,
  },
  {
    color: "success.main",
    min: 5,
    minInclusive: false,
  },
];

export const DRAWDOWN_COLOR_RANGES: RangedValueColorRange[] = [
  {
    color: "error.main",
    max: -5,
    maxInclusive: true,
  },
  {
    color: "warning.main",
    max: -2,
    min: -5,
    minInclusive: false,
  },
  {
    color: "success.main",
    min: -2,
  },
];

export const PROFIT_LOSS_COLOR_RANGES: RangedValueColorRange[] = [
  {
    color: "error.main",
    max: 0,
  },
  {
    color: "warning.main",
    max: 0,
    maxInclusive: true,
    min: 0,
  },
  {
    color: "success.main",
    min: 0,
    minInclusive: false,
  },
];
