import runtimeMcpBalance from "./balance";
import runtimeMcpEngineState from "./engine-state";
import runtimeMcpFinanceSummary from "./finance-summary";
import runtimeMcpHistory from "./history";
import runtimeMcpTradeHistoryPagination from "./history-pagination";
import runtimeMcpIdentity from "./identity";
import runtimeMcpMonitoring from "./monitoring";
import runtimeMcpTokens from "./tokens";
import type {
  RuntimeMcpAuthenticatedToken,
  RuntimeMcpToolDefinition,
  RuntimeMcpToolHandler,
} from "./types";

const WRITE_TOOL_NOTICE =
  "WRITE TOOL: Before calling this tool, show the user a draft of exactly what will change and ask for confirmation.";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const toolDefinitions: RuntimeMcpToolDefinition[] = [
  {
    name: "slow_tags_list",
    description:
      "List reusable coin tags, their descriptions, filter JSON, and assigned coin symbols.",
    permission: "tags.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({}),
  },
  {
    name: "slow_tags_create",
    description: `${WRITE_TOOL_NOTICE} Create one reusable coin tag.`,
    permission: "tags.write",
    inputSchema: jsonSchema(
      {
        text: { type: "string", description: "Tag name." },
        color: { type: "string", description: "Hex color, for example #00ff00." },
        description: { type: "string", description: "Optional tag description." },
        filters: {
          type: ["object", "null"],
          description: "Optional coin filter JSON stored on the tag.",
        },
      },
      ["text", "color"],
    ),
  },
  {
    name: "slow_tags_update",
    description: `${WRITE_TOOL_NOTICE} Update one reusable coin tag, including its optional filters JSON.`,
    permission: "tags.write",
    inputSchema: jsonSchema(
      {
        tagId: { type: "number", description: "Existing tag id." },
        text: { type: "string", description: "Tag name." },
        color: { type: "string", description: "Hex color, for example #00ff00." },
        description: { type: "string", description: "Optional tag description." },
        filters: {
          type: ["object", "null"],
          description: "Optional coin filter JSON stored on the tag.",
        },
      },
      ["tagId", "text", "color"],
    ),
  },
  {
    name: "slow_tags_delete",
    description: `${WRITE_TOOL_NOTICE} Delete one reusable coin tag and all coin attachments for it.`,
    permission: "tags.write",
    inputSchema: jsonSchema(
      {
        tagId: { type: "number", description: "Existing tag id." },
      },
      ["tagId"],
    ),
  },
  {
    name: "slow_coin_metadata_get",
    description:
      "Read coin descriptions and tag attachments. Pass a symbol to return only one coin.",
    permission: "coin_metadata.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({
      symbol: {
        type: "string",
        description: "Optional coin symbol, for example BTC.",
      },
    }),
  },
  {
    name: "slow_coin_metadata_update",
    description: `${WRITE_TOOL_NOTICE} Update one coin description and/or replace its attached tags. This auto-broadcasts through the current coin metadata sync behavior.`,
    permission: "coin_metadata.write",
    inputSchema: jsonSchema(
      {
        symbol: { type: "string", description: "Coin symbol, for example BTC." },
        description: {
          type: "string",
          description: "Optional description. Empty string clears it.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional replacement tag names for this coin.",
        },
      },
      ["symbol"],
    ),
  },
  {
    name: "slow_coin_metadata_broadcast",
    description:
      "Manually broadcast the current coin metadata state to configured/manual peer instances.",
    permission: "coin_metadata.broadcast",
    inputSchema: jsonSchema({
      peers: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional peer origins. Defaults to the project manual broadcast peers.",
      },
    }),
  },
  {
    name: "slow_monitoring_snapshot_read",
    description:
      "Read a versioned, credential-free snapshot of SLOW profile configuration, all account identities and effective strategies, withdrawal and Safe Haven schedules, and optional bounded operational logs.",
    permission: "monitoring.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({
      mode: {
        type: "string",
        enum: ["active", "live", "sandbox"],
        description: "Mode context. Defaults to active.",
      },
      include: {
        type: "array",
        items: { type: "string", enum: ["config", "automation", "logs"] },
        description: "Sections to include. Defaults to config and automation.",
      },
      logLimit: {
        type: "number",
        description: "Maximum recent entries per log kind, from 1 to 100. Defaults to 20.",
      },
    }),
  },
  {
    name: "slow_balance_read",
    description:
      "Read the canonical SLOW USDT balance across all enabled exchange accounts, with an account breakdown. Returns available exchange-free balance, spendable capital, virtual reserve, Safe Haven, locked active-position margin, total asset, formulas, and a plain-language meaning for every field. totalAsset is available plus locked and is not floating equity or unrealized P&L.",
    permission: "balance.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({
      mode: {
        type: "string",
        enum: ["active", "live", "sandbox"],
        description:
          "Balance mode. active uses the current app mode; live attempts an exchange refresh; sandbox uses simulated state. Defaults to active.",
      },
    }),
  },
  {
    name: "slow_engine_state_read",
    description:
      "Read the Precision runtime engine state: lifecycle flags, config with account credentials and token secrets stripped, per-account balances, open positions with their entry/close volatility-point ids, mark prices with staleness, and per-symbol volatility points including which account consumed each point id (usedBy markers). When the engine is stopped, stateSource reports retained or hydrated instead of live. Use to debug entry blocks such as VOLATILITY_POINT_USED.",
    permission: "engine_state.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({
      symbol: {
        type: "string",
        description:
          "Optional coin symbol, for example LINK or LINK_USDT. Returns the recent volatility-point array for that symbol.",
      },
      vPointsLimit: {
        type: "number",
        description:
          "Maximum volatility points returned for the requested symbol, taken from the end of the array. Defaults to 200, maximum 1000.",
      },
      includePnlHistory: {
        type: "boolean",
        description:
          "Include each position's pnl.history points (bounded). Defaults to false.",
      },
    }),
  },
  {
    name: "slow_finance_summary",
    description:
      "Summarize realized net USDT P&L across every enabled exchange account from closed SLOW trades inside one bounded UTC date range. Disabled accounts, balance changes, and open-position unrealized P&L are excluded.",
    permission: "trade_history.read",
    readOnlyHint: true,
    inputSchema: jsonSchema(
      {
        start: {
          type: "string",
          description: "Inclusive UTC start date in YYYY-MM-DD format.",
        },
        end: {
          type: "string",
          description: "Inclusive UTC end date in YYYY-MM-DD format.",
        },
        mode: {
          type: "string",
          enum: ["live", "sandbox"],
          description: "Trading mode. Defaults to live.",
        },
      },
      ["start", "end"],
    ),
  },
  {
    name: "slow_trade_history_read",
    description:
      "Read combined SLOW trade history and open positions across every enabled exchange account. Each position retains its account slug and disabled accounts are excluded.",
    permission: "trade_history.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({
      mode: {
        type: "string",
        enum: ["active", "live", "sandbox"],
        description: "History mode. Defaults to active.",
      },
      symbol: {
        type: "string",
        description: "Optional symbol filter, for example BTC.",
      },
      limit: {
        type: "number",
        description: "Maximum closed history rows to return. Defaults to 50.",
      },
      cursor: {
        type: "string",
        maxLength: 2048,
        description:
          "Opaque cursor from the previous page. It is bound to the resolved mode and symbol filter.",
      },
      includeOpenPositions: {
        type: "boolean",
        description: "Whether to include open positions. Defaults to true.",
      },
    }),
  },
];

/** Handlers registered by the composition root for non-system tool backends. */
const externalHandlers = new Map<string, RuntimeMcpToolHandler>();

/** Registers one tool handler owned outside the system layer. */
function registerHandler(name: string, handler: RuntimeMcpToolHandler): void {
  externalHandlers.set(name, handler);
}

/** Clears registered external handlers (test isolation). */
function resetHandlers(): void {
  externalHandlers.clear();
}

function getAllowedTools(auth: RuntimeMcpAuthenticatedToken) {
  return toolDefinitions.filter((tool) => auth.permissions.has(tool.permission));
}

function getToolList(auth: RuntimeMcpAuthenticatedToken) {
  const appName = runtimeMcpIdentity.getAppName();
  return getAllowedTools(auth).map((tool) => ({
    name: tool.name,
    description: `SLOW app "${appName}". ${tool.description}`,
    inputSchema: tool.inputSchema,
    _meta: {
      "slowTrading/appName": appName,
    },
    annotations: {
      readOnlyHint: tool.readOnlyHint === true,
      destructiveHint: tool.readOnlyHint !== true,
    },
  }));
}

async function call(params: {
  auth: RuntimeMcpAuthenticatedToken;
  name: string;
  arguments: Record<string, unknown>;
}) {
  const args = params.arguments ?? {};
  const definition = toolDefinitions.find((tool) => tool.name === params.name);
  if (!definition) {
    throw new Error(`Unknown MCP tool: ${params.name}`);
  }

  runtimeMcpTokens.assertPermission(params.auth, definition.permission);

  const external = externalHandlers.get(params.name);
  if (external) {
    return external({ args, auth: params.auth });
  }

  if (params.name === "slow_balance_read") {
    // PROD:MCP_BALANCE
    // PROD:MULTI_ACCOUNT_COMBINED_MCP_BALANCE
    return runtimeMcpBalance.read({
      instanceName: runtimeMcpIdentity.getAppName(),
      requestedMode: args.mode,
    });
  }

  if (params.name === "slow_monitoring_snapshot_read") {
    return runtimeMcpMonitoring.read(
      {
        mode: args.mode as "active" | "live" | "sandbox" | undefined,
        include: args.include as ("config" | "automation" | "logs")[] | undefined,
        logLimit: Number(args.logLimit) || undefined,
      },
      runtimeMcpIdentity.getAppName(),
    );
  }

  if (params.name === "slow_engine_state_read") {
    // PROD:MCP_ENGINE_STATE
    return runtimeMcpEngineState.read({
      includePnlHistory: args.includePnlHistory === true,
      symbol: String(args.symbol ?? ""),
      vPointsLimit: Number(args.vPointsLimit) || undefined,
    });
  }

  if (params.name === "slow_trade_history_read") {
    // PROD:MULTI_ACCOUNT_COMBINED_MCP_DATA
    const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
    const includeOpenPositions = args.includeOpenPositions !== false;
    const combined = await runtimeMcpHistory.read({
      defaultMode: "active",
      includeOpenPositions,
      requestedMode: args.mode,
      symbol: String(args.symbol ?? ""),
    });
    const page = runtimeMcpTradeHistoryPagination.paginate({
      cursor: args.cursor,
      limit,
      mode: combined.mode,
      positions: combined.closed,
      symbol: String(args.symbol ?? ""),
    });

    return cloneJson({
      accounts: combined.accounts,
      activeMode: combined.activeMode,
      mode: combined.mode,
      history: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      openPositions: combined.open,
      totalClosed: combined.closed.length,
    });
  }

  if (params.name === "slow_finance_summary") {
    // PROD:MCP_FINANCE_SUMMARY
    // PROD:MULTI_ACCOUNT_COMBINED_MCP_DATA
    const combined = await runtimeMcpHistory.read({
      defaultMode: "live",
      includeOpenPositions: false,
      requestedMode: args.mode,
    });

    return {
      ...runtimeMcpFinanceSummary.create({
        end: String(args.end ?? ""),
        instanceName: runtimeMcpIdentity.getAppName(),
        mode: combined.mode,
        positions: combined.closed,
        start: String(args.start ?? ""),
      }),
      accounts: combined.accounts,
    };
  }

  throw new Error(`MCP tool is not available: ${params.name}`);
}

const runtimeMcpTools = {
  call,
  catalog: () =>
    toolDefinitions.map((tool) => ({
      description: tool.description,
      name: tool.name,
      permission: tool.permission,
      readOnly: tool.readOnlyHint === true,
    })),
  list: getToolList,
  registerHandler,
  resetHandlers,
} as const;

export default runtimeMcpTools;
