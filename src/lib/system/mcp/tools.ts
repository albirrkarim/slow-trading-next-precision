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
    name: "tags_list",
    description:
      "List reusable coin tags, their descriptions, filter JSON, and assigned coin symbols.",
    permission: "tags.read",
    readOnlyHint: true,
    inputSchema: jsonSchema({}),
  },
  {
    name: "tags_create",
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
    name: "tags_update",
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
    name: "tags_delete",
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
    name: "coin_metadata_get",
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
    name: "coin_metadata_update",
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
    name: "coin_metadata_broadcast",
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
    name: "monitoring_snapshot_read",
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
    name: "balance_read",
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
    name: "engine_state_read",
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
    name: "finance_summary",
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
    name: "trade_history_read",
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
  {
    name: "backtest_config_template",
    description:
      "LOCALHOST DEV INSTANCE ONLY. Read the dashboard's current backtest input as a BacktestTestCase plus per-symbol dataset coverage (first/last available day). Clone and mutate it for backtest_precision_run; coverage bounds show the effective range each symbol can actually backtest.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema({}),
  },
  {
    name: "backtest_precision_run",
    description: `${WRITE_TOOL_NOTICE} LOCALHOST DEV INSTANCE ONLY. Start a precision backtest asynchronously and return its cacheKey immediately — poll backtest_run_status until done. Identical params join the in-flight run or reuse the result cache; a different run while one is in flight returns status "busy" — wait for it and retry rather than racing parallel simulations. Shares CPU with the live engine; prefer running while paused or on the dev instance.`,
    permission: "backtest.run",
    devOnly: true,
    inputSchema: jsonSchema(
      {
        config: {
          type: "object",
          description:
            "Runtime config (BacktestTestCase.config) — start from backtest_config_template output.",
        },
        range: {
          type: "string",
          description:
            "Named range such as 1month/6month/1year/2year, or custom with explicit startTime/endTime.",
        },
        startTime: {
          type: "number",
          description: "Custom-range start in epoch ms. Requires endTime.",
        },
        endTime: {
          type: "number",
          description: "Custom-range end in epoch ms. Requires startTime.",
        },
        upToDateKlines: {
          type: "boolean",
          description:
            "Refresh the candle dataset before running. Defaults to false.",
        },
        upToDateDecisionBacktest: {
          type: "boolean",
          description: "Bypass the saved result cache. Defaults to false.",
        },
      },
      ["config", "range"],
    ),
  },
  {
    name: "backtest_run_status",
    description:
      "LOCALHOST DEV INSTANCE ONLY. Report a backtest run's state: running | done | failed | interrupted, plus the summary and effective dataset start/end (a symbol with a later listing date clips the whole run). Pass the cacheKey from backtest_precision_run.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema(
      {
        cacheKey: {
          type: "string",
          description: "64-char cache key returned by backtest_precision_run.",
        },
      },
      ["cacheKey"],
    ),
  },
  {
    name: "backtest_result_read",
    description:
      "LOCALHOST DEV INSTANCE ONLY. Read one artifact field from a finished run — field=positions|vpoints|snapshots — with optional server-side sort (e.g. sort=pnl.netUsdt order=asc for biggest losses) and offset/limit paging. vpoints/snapshots take name=<symbol|account slug> to scope.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema(
      {
        cacheKey: { type: "string", description: "64-char cache key." },
        field: {
          type: "string",
          enum: ["positions", "vpoints", "snapshots"],
        },
        name: {
          type: "string",
          description:
            "Scope field=vpoints to a symbol or field=snapshots to an account slug.",
        },
        sort: {
          type: "string",
          description:
            "Dot-path field to sort positions by, e.g. pnl.netUsdt.",
        },
        order: { type: "string", enum: ["asc", "desc"] },
        offset: { type: "number" },
        limit: { type: "number", description: "Defaults to 100, max 1000." },
      },
      ["cacheKey", "field"],
    ),
  },
  {
    name: "backtest_runs_list",
    description:
      "LOCALHOST DEV INSTANCE ONLY. List cached precision backtest runs newest-first — cacheKey, params (range, symbols), counts, summary. Use to compare trial configs without re-running.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema({
      limit: { type: "number", description: "Defaults to 20, max 100." },
    }),
  },
  {
    name: "backtest_trade_inspect",
    description:
      "LOCALHOST DEV INSTANCE ONLY. Inspect one trade like the chart dialog: position detail, sibling pair leg, volatility points in window, level lines, and a 1m kline window cropped to opened-/+padDays (default 7, 0=trade span only, max 30). Pass a tradeId from backtest_result_read positions.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema(
      {
        cacheKey: { type: "string", description: "64-char cache key." },
        tradeId: { type: "string", description: "Position/trade id." },
        padDays: {
          type: "number",
          description:
            "Context days around opened→closed. Defaults to 7, max 30.",
        },
      },
      ["cacheKey", "tradeId"],
    ),
  },
  {
    name: "backtest_result_metrics",
    description:
      "LOCALHOST DEV INSTANCE ONLY. Compute the leaderboard metric set (gain, Sharpe, drawdowns, bear-market resilience, win rate) for a cached run without saving anything — preview before backtest_leaderboard_save.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema(
      {
        cacheKey: { type: "string", description: "64-char cache key." },
      },
      ["cacheKey"],
    ),
  },
  {
    name: "backtest_leaderboard_save",
    description: `${WRITE_TOOL_NOTICE} LOCALHOST DEV INSTANCE ONLY. Save a finished run to the leaderboards — recomputes metrics server-side from the cached artifacts. Saving the same config+run overwrites the existing entry. The board is a scoreboard: only save runs that beat the existing entries on the same range — higher gain at equal-or-lower min equity and floating drawdown, or equal metrics at lower equity.`,
    permission: "backtest.leaderboard.write",
    devOnly: true,
    inputSchema: jsonSchema(
      {
        cacheKey: { type: "string", description: "64-char cache key." },
        label: {
          type: "string",
          description:
            "Display label — prefix with your agent slug and say what changed (e.g. 'swe_2 lvl2-handoff 350+500').",
        },
      },
      ["cacheKey"],
    ),
  },
  {
    name: "backtest_leaderboard_list",
    description:
      "LOCALHOST DEV INSTANCE ONLY. List saved leaderboard entries newest-first with their metric sets and source cacheKeys.",
    permission: "backtest.read",
    devOnly: true,
    readOnlyHint: true,
    inputSchema: jsonSchema({}),
  },
  {
    name: "backtest_leaderboard_delete",
    description: `${WRITE_TOOL_NOTICE} LOCALHOST DEV INSTANCE ONLY. Delete one leaderboard entry by its 12-char id.`,
    permission: "backtest.leaderboard.write",
    devOnly: true,
    inputSchema: jsonSchema(
      {
        id: { type: "string", description: "12-char leaderboard entry id." },
      },
      ["id"],
    ),
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
  /** Composition-root gate value for devOnly tools (isDevBacktestEnabled). */
  devToolsEnabled?: boolean;
}) {
  const args = params.arguments ?? {};
  const definition = toolDefinitions.find((tool) => tool.name === params.name);
  if (!definition) {
    throw new Error(`Unknown MCP tool: ${params.name}`);
  }

  runtimeMcpTokens.assertPermission(params.auth, definition.permission);

  // BTEST:MCP_DEV_GATE — dev-only tools stay listed for discovery but warn
  // instead of running on instances where dev tooling is disabled.
  if (definition.devOnly && params.devToolsEnabled !== true) {
    return {
      warning:
        "Backtest tools are only available on the local dev instance — connect to the localhost MCP endpoint.",
    };
  }

  const external = externalHandlers.get(params.name);
  if (external) {
    return external({ args, auth: params.auth });
  }

  if (params.name === "balance_read") {
    // PROD:MCP_BALANCE
    // PROD:MULTI_ACCOUNT_COMBINED_MCP_BALANCE
    return runtimeMcpBalance.read({
      instanceName: runtimeMcpIdentity.getAppName(),
      requestedMode: args.mode,
    });
  }

  if (params.name === "monitoring_snapshot_read") {
    return runtimeMcpMonitoring.read(
      {
        mode: args.mode as "active" | "live" | "sandbox" | undefined,
        include: args.include as ("config" | "automation" | "logs")[] | undefined,
        logLimit: Number(args.logLimit) || undefined,
      },
      runtimeMcpIdentity.getAppName(),
    );
  }

  if (params.name === "engine_state_read") {
    // PROD:MCP_ENGINE_STATE
    return runtimeMcpEngineState.read({
      includePnlHistory: args.includePnlHistory === true,
      symbol: String(args.symbol ?? ""),
      vPointsLimit: Number(args.vPointsLimit) || undefined,
    });
  }

  if (params.name === "trade_history_read") {
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

  if (params.name === "finance_summary") {
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
