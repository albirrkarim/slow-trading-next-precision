/**
 * Indicator registry — one definition per indicator type. The feed, the
 * feature store, config validation, the settings form, dataset filters,
 * and the chart all go through these, so every surface uses the same
 * math. Adding a type: a file exporting its `definition`, plus one line
 * here.
 */

import ema from "./ema";
import supertrend from "./supertrend";
import type {
  FeatureIndicatorConfig,
  FeatureIndicatorType,
  IndicatorDefinition,
} from "./types";
import vwap from "./vwap";

const definitions: {
  [T in FeatureIndicatorType]: IndicatorDefinition<
    Extract<FeatureIndicatorConfig, { type: T }>,
    any,
    any
  >;
} = {
  supertrend: supertrend.definition,
  ema: ema.definition,
  vwap: vwap.definition,
};

/** Registered types, in menu order. */
const types = Object.keys(definitions) as FeatureIndicatorType[];

/** Definition for an instance's type. */
function of(cfg: Pick<FeatureIndicatorConfig, "type">): IndicatorDefinition<any, any, any> {
  return definitions[cfg.type];
}

const indicatorRegistry = { definitions, of, types } as const;

export default indicatorRegistry;
