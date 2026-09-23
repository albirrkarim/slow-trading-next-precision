import { SYSTEM_API } from "./constants";

export const systemEndpoints = {
  state: `${SYSTEM_API}/state`,
  history: `${SYSTEM_API}/history`,
  logs: `${SYSTEM_API}/logs`,
  queue: `${SYSTEM_API}/queue`,
  reset: `${SYSTEM_API}/reset`,
  withdraw: `${SYSTEM_API}/withdraw`,
  quickBacktest: `${SYSTEM_API}/quick-backtest`,
  mcpTokens: `${SYSTEM_API}/mcp-tokens`,
  notificationTest: `${SYSTEM_API}/notification-test`,
  precisionTestCase: `${SYSTEM_API}/precision-test-case`,
  balance: {
    refresh: `${SYSTEM_API}/balance/refresh`,
    snapshots: `${SYSTEM_API}/balance/snapshots`,
  },
  manual: {
    entry: `${SYSTEM_API}/manual/entry`,
    exit: `${SYSTEM_API}/manual/exit`,
    diagnostics: `${SYSTEM_API}/manual/diagnostics`,
  },
  coin: {
    metadata: `${SYSTEM_API}/coin/metadata`,
  },
  blackSwan: {
    state: `${SYSTEM_API}/black-swan`,
    preview: `${SYSTEM_API}/black-swan/preview`,
  },
  account: {
    list: `${SYSTEM_API}/account`,
  },
  exchange: {
    cooldownReset: `${SYSTEM_API}/exchange/cooldown-reset`,
  },
  debug: {
    broadcastCoinMetadata: `${SYSTEM_API}/debug/broadcast-coin-metadata`,
    exportData: `${SYSTEM_API}/debug/export`,
    importData: `${SYSTEM_API}/debug/import`,
    syncLocalToOnline: `${SYSTEM_API}/debug/sync-local-to-online`,
    syncOnlineCoinMetadataToLocal: `${SYSTEM_API}/debug/sync-online-coin-metadata-to-local`,
    syncOnlineToLocal: `${SYSTEM_API}/debug/sync-online-to-local`,
  },
} as const;
