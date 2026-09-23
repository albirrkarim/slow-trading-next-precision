import type { RuntimeAccountConfig } from "../runtime/types";
import { runtimeStorage } from "../storage";
import type {
  RuntimeAccountModeState,
  RuntimeMode,
} from "../storage/runtime";

export interface RuntimeMcpAccountScope {
  accounts: RuntimeAccountConfig[];
  activeMode: RuntimeMode;
  mode: RuntimeMode;
}

export interface RuntimeMcpAccountState {
  account: RuntimeAccountConfig;
  modeState: RuntimeAccountModeState;
}

/** Resolves the enabled accounts and concrete mode included in an MCP read. */
async function resolve(params: {
  defaultMode: "active" | RuntimeMode;
  requestedMode: unknown;
}): Promise<RuntimeMcpAccountScope> {
  const catalog = await runtimeStorage.catalog.ensure();
  const activeMode = catalog.mode;
  const requestedMode = String(params.requestedMode ?? params.defaultMode);
  const mode: RuntimeMode =
    requestedMode === "live" || requestedMode === "sandbox"
      ? requestedMode
      : activeMode;
  const accounts = catalog.config.accounts.filter(
    (account) => account.enabled,
  );

  if (accounts.length === 0) {
    throw new Error(
      "SLOW has no enabled exchange accounts to include in MCP data.",
    );
  }

  return { accounts, activeMode, mode };
}

/** Loads isolated mode state for every account in an MCP account scope. */
async function loadAccountStates(
  scope: RuntimeMcpAccountScope,
): Promise<RuntimeMcpAccountState[]> {
  return Promise.all(
    scope.accounts.map(async (account) => ({
      account,
      modeState: await runtimeStorage.account.load({
        accountSlug: account.slug,
        mode: scope.mode,
      }),
    })),
  );
}

const runtimeMcpAccountScope = {
  loadAccountStates,
  resolve,
} as const;

export default runtimeMcpAccountScope;
