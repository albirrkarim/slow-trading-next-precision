# Data Types — V1

V1 reuses current Multi trading, runtime, and backtest types, adding only what all three strategies and comparison need.

# A. Rules

- Keep one common position type with a strategy-specific data field.
- Reuse existing field names where possible to reduce migration work.
- All timestamps are Unix milliseconds.
- `pct` values use percentage points: `1.5` means `1.5%`.
- Persisted JSON remains compact and backward compatible.
- Raw exchange requests and responses stay outside position JSON.

# B. Shared identifiers

```ts
type RuntimeMode = "live" | "sandbox" | "backtest";
type StrategyId = "multi" | "hedge" | "streak";
type PositionDirection = "LONG" | "SHORT";
type PositionRole = "MAIN" | "COUNTER";
type ExecutionKind = "ENTRY" | "AVERAGE" | "EXIT";
```

# C. Execution record

Every entry, averaging, and exit stores enough data for the first checker:

```ts
interface TradeExecution {
  id: string;
  kind: ExecutionKind;
  side: "BUY" | "SELL";
  orderType: string;
  expectedPrice: number;
  fillPrice: number;
  requestedQuantity: number;
  filledQuantity: number;
  feeUSDT: number;
  requestT: number;
  acknowledgementT?: number;
  fillT: number;
  status: string;
}
```

Calculate slippage and latency per execution, not once for the whole position.

TC: `BOTH:TRADE_EXECUTION_EVIDENCE`

# D. Shared position

Use the existing `Position` as the migration base. It identifies the account,
strategy, market, executions, PnL, fees, and strategy-specific data:

```ts
interface PositionV1 {
  id: string;
  account: string;
  strategy: StrategyId;
  symbol: string;
  direction: PositionDirection;
  role?: PositionRole;
  executions: TradeExecution[];
  pnl: PositionPnl;
  strategyData: MultiData | HedgeData | StreakData;
}
```

- Multi keeps its one-direction data.
- Hedge keeps MAIN/COUNTER and pair data.
- Streak also keeps its re-entry state.

Do not put account-specific used-vPoint state on shared market objects.

TC: `BOTH:SHARED_POSITION_TYPE`

# E. Runtime and comparison data

`RuntimeState` keeps balances, positions, orders, and strategy state per account.
Live, sandbox, and backtest storage remain separate.

```ts
interface ProdTestCase {
  mode: "live" | "sandbox";
  startTime: number;
  endTime: number;
  config: { runtime: RuntimeConfig; trading: TradingConfig };
  initialState: RuntimeState;
  tradeHistory: TradeExecution[];
}
```

Backtest results should extend the current `BacktestReturnDynamic` instead of
introducing a completely unrelated result shape.

# F. Migration

Readers accept current position and history JSON during migration. Add a schema
number only when a persisted shape changes. Event envelopes, manifests, checksums,
and generalized reports are deferred.
