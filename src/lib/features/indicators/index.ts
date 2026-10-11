import indicatorCandles from "./feed/candles";
import indicatorConfig from "./config";
import indicatorFeed from "./feed";
import indicatorRead from "./read";
import indicatorRegistry from "./registry";
import emaMath from "./ema";
import supertrendMath from "./supertrend";
import type {
  CoinIndicators,
  FeatureIndicatorConfig,
  FeatureIndicatorType,
  IndicatorAccumulator,
  IndicatorDeriveContext,
} from "./types";
import vwapMath from "./vwap";

/** Shallow equality for flat reading objects. */
function sameReading(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

/**
 * Readings of every enabled instance for one coin, grouped
 * `ind.<type>.<id>`. A reading equal to the previous pass reuses the
 * previous object so identity diffs stay sparse. Undefined when no
 * instance has a reading yet (warm-up).
 */
function derive({
  instances,
  acc,
  symbol,
  context,
  previous,
}: {
  instances: FeatureIndicatorConfig[];
  acc: Record<string, Record<string, IndicatorAccumulator>> | undefined;
  symbol: string;
  context: IndicatorDeriveContext;
  previous?: CoinIndicators;
}): CoinIndicators | undefined {
  const out: Record<string, Record<string, object>> = {};
  for (const cfg of instances) {
    const value = indicatorRegistry
      .of(cfg)
      .derive(acc?.[indicatorConfig.key(cfg)]?.[symbol], cfg, context);
    if (value === undefined) continue;
    const before = (previous as Record<string, Record<string, object>> | undefined)?.[
      cfg.type
    ]?.[cfg.id];
    (out[cfg.type] ??= {})[cfg.id] =
      before && sameReading(before, value) ? before : value;
  }
  return Object.keys(out).length > 0 ? (out as CoinIndicators) : undefined;
}

/**
 * True when any instance's `changeKey` differs between two coin readings
 * (e.g. a Supertrend flip). VWAP never counts — its fields move every pass.
 */
function changed(
  before: CoinIndicators | undefined,
  after: CoinIndicators | undefined,
): boolean {
  const left = (before ?? {}) as Record<string, Record<string, unknown>>;
  const right = (after ?? {}) as Record<string, Record<string, unknown>>;
  for (const type of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const definition =
      indicatorRegistry.definitions[type as FeatureIndicatorType];
    if (!definition) continue;
    const ids = new Set([
      ...Object.keys(left[type] ?? {}),
      ...Object.keys(right[type] ?? {}),
    ]);
    for (const id of ids) {
      if (
        definition.changeKey(left[type]?.[id]) !==
        definition.changeKey(right[type]?.[id])
      ) {
        return true;
      }
    }
  }
  return false;
}

const indicators = {
  candles: indicatorCandles,
  changed,
  config: indicatorConfig,
  derive,
  feed: indicatorFeed,
  math: { ema: emaMath, supertrend: supertrendMath, vwap: vwapMath },
  read: indicatorRead,
  registry: indicatorRegistry,
} as const;

export default indicators;
export type * from "./types";
export {
  GATE_VWAP_ID,
  INDICATOR_ID_PATTERN,
  INDICATOR_INTERVALS,
  INDICATOR_INTERVAL_MS,
  MAX_INDICATORS,
} from "./constants";
