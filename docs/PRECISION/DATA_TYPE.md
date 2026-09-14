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
```

# C. Shared position

Use the existing `Position` as the migration base. It identifies the account,
strategy, market, PnL, fees, and strategy-specific data:

```ts
interface PositionV1 {
  account: string;
  strategy: StrategyId;
  symbol: string;
  direction: PositionDirection;
  role?: PositionRole;
  opened: { t: number; vPoint: { id: string; lvl: number }; price: number };
  pnl: PositionPnl;
  strategyData: MultiData | HedgeData | StreakData;
}
```

- Multi keeps its one-direction data.
- Hedge keeps MAIN/COUNTER and pair data.
- Streak also keeps its re-entry state.

Do not put account-specific used-vPoint state on shared market objects.

TC: `BOTH:SHARED_POSITION_TYPE`

# D. Runtime and comparison data

`RuntimeState` keeps balances, positions, orders, and strategy state per account.
Live, sandbox, and backtest storage remain separate.

```ts
interface ProdTestCase {
  mode: "live" | "sandbox";
  startTime: number;
  endTime: number;
  config: { runtime: RuntimeConfig; trading: TradingConfig };
  initialState: RuntimeState;
  endPositions: PositionV1[];
}
```

Backtest results expose the same `endPositions` shape. The candidate key is
account, symbol, direction, entry `vPoint.id`, and role or pair identity when
required. `executionMode` is excluded from result comparison.

# E. Migration

Readers accept current position and history JSON during migration. Add a schema
number only when a persisted shape changes. Event envelopes, manifests, checksums,
and generalized reports are deferred.
