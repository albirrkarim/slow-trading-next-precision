/**
 * Dynamic indicator features — configurable indicator instances
 * (`management.indicators`) computed by the shared feature feed in
 * backtest, sandbox, and live, written to `coins[s].ind.<type>.<id>` and
 * snapshotted into positions at entry. Pure types; no I/O. Each indicator's
 * own types live in its folder and are re-exported here.
 */

import type { CoinEma, EmaAccumulator, EmaFeatureConfig } from "./ema/types";
import type {
  CoinSupertrend,
  SupertrendAccumulator,
  SupertrendFeatureConfig,
} from "./supertrend/types";
import type { CoinVwap, VwapAccumulator, VwapFeatureConfig } from "./vwap/types";

export type * from "./ema/types";
export type * from "./supertrend/types";
export type * from "./vwap/types";

/** Indicator kinds the registry knows how to fold. */
export type FeatureIndicatorType = "vwap" | "supertrend" | "ema";

/**
 * Candle intervals an instance may fold. Everything above the feed's base
 * interval (1m when any instance needs it, else 5m) is aggregated from base
 * candles on UTC-aligned boundaries — the live stream only carries 1m/5m.
 */
export type FeatureIndicatorInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "1d";

/** Fields every indicator instance carries. */
export interface FeatureIndicatorBase {
  /**
   * Stable instance key — the `<id>` in `coins[s].ind.<type>.<id>` and in
   * position `defs`. Lowercase `[a-z][a-z0-9_]*`, max 16 chars, unique
   * across all types. Renaming only moves where values are read from: the
   * running state is keyed by params, so it never re-warms on rename.
   */
  id: string;
  type: FeatureIndicatorType;
  interval: FeatureIndicatorInterval;
  /** `false` keeps the instance configured but uncomputed. Default on. */
  on?: boolean;
}

export type FeatureIndicatorConfig =
  | VwapFeatureConfig
  | SupertrendFeatureConfig
  | EmaFeatureConfig;

/** One closed candle fed to an indicator — `t` is its open time (ms). */
export interface FoldCandle {
  t: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Running state of any indicator — the registry knows which is which. */
export type IndicatorAccumulator =
  | VwapAccumulator
  | SupertrendAccumulator
  | EmaAccumulator;

/**
 * Per-coin indicator readings grouped by type then instance id:
 * `ind.supertrend.st15.d`. Only enabled instances with a reading appear.
 */
export interface CoinIndicators {
  vwap?: Record<string, CoinVwap>;
  supertrend?: Record<string, CoinSupertrend>;
  ema?: Record<string, CoinEma>;
}

/** Instance definitions keyed by id — stored with every entry snapshot. */
export type FeatureIndicatorDefs = Record<string, FeatureIndicatorConfig>;

/** Signal context a reading may depend on. */
export interface IndicatorDeriveContext {
  markPrice?: number;
  /** Latest vPoint price — VWAP's σ distance is measured from it. */
  signalPrice?: number;
}

/**
 * One type-specific config param (beyond id/type/interval/on). Drives
 * validation on save and the Settings → Features form.
 */
export type IndicatorField =
  | {
      key: string;
      label: string;
      kind: "integer" | "number";
      min: number;
      max: number;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      options: readonly string[];
    };

/** Numeric reading field exposed to dataset filters as `ind:<type>:<id>:<key>`. */
export interface IndicatorMetric<V> {
  label: string;
  /** `t` is the row's capture time (ms) for age-style metrics. */
  read(value: V | undefined, t: number | undefined): unknown;
}

/**
 * Everything one indicator type contributes — config shape, running-state
 * math, reading, and change semantics. Adding a type means one file that
 * exports its definition plus one registry line.
 */
export interface IndicatorDefinition<
  C extends FeatureIndicatorConfig,
  A extends IndicatorAccumulator,
  V,
> {
  type: C["type"];
  label: string;
  /** Prefix of generated ids (`st1`, `st2`, …). */
  idPrefix: string;
  /** Type-specific params, in form order. */
  fields: readonly IndicatorField[];
  /** Params of a freshly added instance (everything but id/type/on). */
  defaults: Omit<C, "id" | "type" | "on">;
  /**
   * Params key — running state is stored under it, so a rename never
   * re-warms and identical params share one accumulator.
   */
  key(cfg: C): string;
  /** Human summary, e.g. "Supertrend 15m · 10 × 3". */
  summary(cfg: C): string;
  state: {
    /** Fresh running state for an instance at `nowMs`. */
    create(cfg: C, nowMs: number): A;
    /** Where a fresh state starts folding history from (ms, inclusive). */
    warmupStartMs(cfg: C, nowMs: number): number;
    /** True when the state must restart (anchor rolled over, too old to resume). */
    stale(acc: A, cfg: C, nowMs: number): boolean;
    fold(acc: A, candle: FoldCandle, cfg: C): void;
  };
  derive(acc: A | undefined, cfg: C, ctx: IndicatorDeriveContext): V | undefined;
  /**
   * The part of a reading that counts as a real change for record/flush
   * diffs. Undefined = never triggers on its own (moves every pass).
   */
  changeKey(value: V | undefined): unknown;
  metrics: Record<string, IndicatorMetric<V>>;
}
