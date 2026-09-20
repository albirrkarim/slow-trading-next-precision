import type { RuntimeEngineState } from "../types";

/** Gets one configured runtime account or fails for inconsistent position state. */
function getAccount(state: RuntimeEngineState, accountSlug: string) {
  const account = state.config.accounts.find(
    (candidate) => candidate.slug === accountSlug,
  );

  if (!account) {
    throw new Error(`Runtime account config not found for ${accountSlug}.`);
  }

  return account;
}

/** Gets the account-owned Trading-tab configuration. */
function getAccountConfig(state: RuntimeEngineState, accountSlug: string) {
  return getAccount(state, accountSlug).trading;
}

/** Gets the mutable in-memory balance owned by one account. */
function getAccountBalance(state: RuntimeEngineState, accountSlug: string) {
  const balance = state.balance[accountSlug];

  if (!balance) {
    throw new Error(`Runtime account balance not found for ${accountSlug}.`);
  }

  return balance;
}

const account = {
  get: getAccount,
  getBalance: getAccountBalance,
  getConfig: getAccountConfig,
} as const;

export default account;
