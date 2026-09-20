import account from "./account";
import market from "./market";
import type { RuntimeEngineAdapter, RuntimeEngineState } from "../types";
import type { RuntimeHelper } from "./types";

/** Binds reusable helper operations to one runtime state object. */
function createRuntimeHelper(
  state: RuntimeEngineState,
  adapter: RuntimeEngineAdapter,
): RuntimeHelper {
  return {
    getAccount: (accountSlug) => account.get(state, accountSlug),
    getAccountBalance: (accountSlug) =>
      account.getBalance(state, accountSlug),
    getAccountConfig: (accountSlug) => account.getConfig(state, accountSlug),
    market: market.create(state, adapter),
  };
}

export { createRuntimeHelper };
export type { RuntimeHelper } from "./types";
