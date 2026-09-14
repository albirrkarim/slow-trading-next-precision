# Data Types — V1

V1 copies the current Multi `Position` as `PositionBase`, then adds only the
existing Hedge and Streak differences. Do not replace proven position fields.

# A. Rules

- All timestamps are Unix milliseconds in UTC.
- `pct` means percentage points: `1.5` means `1.5%`.
- Missing `closed` means open; present `closed` means closed.
- New persisted file formats have `schema: 1`, `strategy`, and `mode`.
- Readers normalize legacy missing Hedge/Streak `role` to `MAIN`.
- Raw exchange payloads do not belong in position JSON.

# B. Canonical position

```ts
type RuntimeMode = "live" | "sandbox" | "backtest";
type StrategyId = "multi" | "hedge" | "streak";
```

The complete `PositionBase` fields come from Multi's
`src/lib/trading/models/type.ts`. The strategy union is discriminated:

```ts
type PositionV1 =
  | (PositionBase & {
      strategyId: "multi";
      strategy: MultiPositionState;
    })
  | (PositionBase & {
      strategyId: "hedge";
      role: "MAIN" | "COUNTER";
      entryLegs?: "MAIN" | "COUNTER" | "BOTH";
      strategy: HedgePositionState;
    })
  | (PositionBase & {
      strategyId: "streak";
      pairId: string;
      role: "MAIN" | "COUNTER";
      entryLegs?: "MAIN" | "COUNTER" | "BOTH";
      strategy: StreakPositionState;
    });
```

New positions always write the required discriminator fields. Migration readers
adapt existing Multi, Hedge, and Streak positions to this union without changing
their trading meaning. Each named strategy-state type aliases that instance's
existing `PositionStrategyState` with its current feature type.

TC: `BOTH:SHARED_POSITION_TYPE`

# C. Production test case

```ts
interface PrecisionRunV1 {
  schema: 1;
  strategy: StrategyId;
  mode: RuntimeMode;
  startTime: number;
  endTime: number;
  config: { runtime: RuntimeConfig; trading: TradingConfig };
  initialState: RuntimeState;
  endPositions: PositionV1[];
}

type ProdTestCaseV1 = PrecisionRunV1 & { mode: "live" | "sandbox" };
type PrecisionBacktestResultV1 = PrecisionRunV1 & { mode: "backtest" };
```

`RuntimeState` is the copied Multi mode-state shape, extended only for a
strategy's existing state. Both run types use the same state and position types.

# D. Comparison identity

The comparison key is:

```text
account + uppercase symbol + direction + opened.vPoint.id + (role ?? "MAIN")
```

`pairId` remains part of Streak position JSON but is not part of this key because
its legacy fallback contains `opened.t`, which may differ between environments.

# E. Compatibility

Validate JSON at read boundaries. Reject unsupported schemas and invalid new
records. Keep explicit readers for existing position and backtest JSON; never
silently reinterpret an old field.
