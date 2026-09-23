import { runtimeStorage } from "../storage";
import type { RuntimeMode } from "../storage/runtime";
import type { RuntimeAccountConfig } from "../runtime/types";
import type { RuntimeHistoryPosition } from "../trading/types";
import runtimeMcpAccountScope from "./account-scope";

export interface RuntimeMcpHistoryAccount {
  name: string;
  slug: string;
  type: RuntimeAccountConfig["type"];
}

export interface RuntimeMcpCombinedHistory {
  accounts: RuntimeMcpHistoryAccount[];
  activeMode: RuntimeMode;
  closed: RuntimeHistoryPosition[];
  mode: RuntimeMode;
  open: RuntimeHistoryPosition[];
}

/** Reads closed and optional open positions across every enabled account. */
async function read(params: {
  defaultMode: "active" | RuntimeMode;
  includeOpenPositions: boolean;
  requestedMode: unknown;
  symbol?: string;
}): Promise<RuntimeMcpCombinedHistory> {
  // PROD:MULTI_ACCOUNT_COMBINED_MCP_DATA
  const scope = await runtimeMcpAccountScope.resolve({
    defaultMode: params.defaultMode,
    requestedMode: params.requestedMode,
  });
  const symbol = String(params.symbol ?? "").trim().toUpperCase();
  const closed = (
    await Promise.all(
      scope.accounts.map((account) =>
        runtimeStorage.history.readAll(scope.mode, { account: account.slug }),
      ),
    )
  )
    .flat()
    .filter((position) => !symbol || position.symbol === symbol);
  let open: RuntimeHistoryPosition[] = [];

  if (params.includeOpenPositions) {
    const states = await runtimeMcpAccountScope.loadAccountStates(scope);
    open = states
      .flatMap(({ modeState }) =>
        modeState.positions
          .filter((position) => !position.closed)
          .map((position) => ({ ...position, mode: scope.mode })),
      )
      .filter((position) => !symbol || position.symbol === symbol)
      .sort((left, right) => left.opened.t - right.opened.t);
  }

  return {
    // PROD:MCP_ACCOUNT_IDENTITY_REDACTION
    accounts: scope.accounts.map((account) => ({
      name: account.name ?? account.slug,
      slug: account.slug,
      type: account.type,
    })),
    activeMode: scope.activeMode,
    closed,
    mode: scope.mode,
    open,
  };
}

const runtimeMcpHistory = { read } as const;

export default runtimeMcpHistory;
