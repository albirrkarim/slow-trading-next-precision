import type { StrategyAPI, StrategySlug } from "./types";

/**
 * Strategy modules resolved lazily by slug — each environment factory calls
 * `resolve(config.management.strategy)` once per engine construction and
 * passes the module into `new RuntimeEngine(state, adapter, strategy)`.
 * An absent slug resolves to undefined, which keeps the built-in default
 * pipeline; an unknown slug fails loudly instead of silently falling back.
 */
const loaders: Record<
  StrategySlug,
  () => Promise<{ default: StrategyAPI }>
> = {
  both: () => import("./both"),
  custom_swe_2_profit_rail_v1: () =>
    import("./custom_swe_2_profit_rail_v1"),
  streak: () => import("./streak"),
};

/** Resolves a configured strategy slug to its module, when one exists. */
async function resolve(slug?: string): Promise<StrategyAPI | undefined> {
  const normalized = String(slug ?? "").trim();
  if (!normalized) return undefined;
  const loader = loaders[normalized as StrategySlug];
  if (!loader) {
    throw new Error(
      `Unknown strategy slug "${normalized}" — expected one of: ` +
        Object.keys(loaders).join(", "),
    );
  }
  const module = await loader();
  return module.default;
}

const strategies = {
  resolve,
} as const;

export default strategies;
export type * from "./types";
