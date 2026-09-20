import account from "./account";
import type { RuntimeEngineState } from "../types";
import type { RuntimeHelper } from "./types";

/** Binds reusable helper operations to one runtime state object. */
function createRuntimeHelper(state: RuntimeEngineState): RuntimeHelper {
  return {
    getAccount: (accountSlug) => account.get(state, accountSlug),
    getAccountBalance: (accountSlug) =>
      account.getBalance(state, accountSlug),
    getAccountConfig: (accountSlug) => account.getConfig(state, accountSlug),
  };
}

export { createRuntimeHelper };
export type { RuntimeHelper } from "./types";
