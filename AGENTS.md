# Agent Instructions

These instructions apply to the whole repository.

## Project Direction

- `docs/PRECISION/_PRECISION.md` is the project backbone and the highest-level
  source of truth for the Precision Trading System.
- Detailed documents explain the backbone. They must not quietly redefine or
  contradict it.
- The project consolidates the existing Multi, Hedge, and Streak systems around
  one shared runtime architecture.
- The migration must preserve documented strategy behavior. Do not redesign a
  strategy unless the specification explicitly requires it.
- Existing repositories are evidence of current behavior, not automatically the
  desired architecture. When current code conflicts with the Precision
  specification, follow the specification and document the migration impact.

## Existing Implementations

Use these repositories when investigating current behavior:

```text
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
```

Do not modify an existing implementation unless the task explicitly includes
that repository.

## Pre-Implementation

- Read `docs/SPECS/_SPECS.md` for the meaning and use of testing codes (`TC`).
- Read `docs/PRECISION/_PRECISION.md` before changing architecture, trading
  behavior, precision guarantees, or migration direction.
- Read the relevant detailed specification before changing its area:
  - `docs/PRECISION/RUNTIME_ENGINE.md` for runtime lifecycle, scheduling,
    adapter responsibilities, ordering, and execution flow.
  - `docs/PRECISION/DATA_TYPE.md` for canonical positions, persisted test cases,
    identifiers, timestamps, and compatibility.
  - `docs/PRECISION/BACKTEST.md` for historical data, simulated time,
    simulated execution, visibility, and end-of-run behavior.
  - `docs/PRECISION/PRECISION_CHECKER.md` for final-position pairing,
    normalization, and result scoring.
  - `docs/PRECISION/FOLDER.md` for module ownership and folder boundaries.
  - `docs/PRECISION/PAGES.md` for dashboard responsibilities and routes.
- Read relevant TypeScript JSDoc and type comments in the existing projects
  before changing a model, config, API, storage shape, exchange adapter,
  trading executor, or dashboard component.
- Trace both backtest and production/live flows before deciding where behavior
  belongs. Check sandbox behavior when execution or storage is affected.
- Check all affected strategies. A solution that works for Multi must not
  accidentally make Hedge or Streak impossible to support.
- Reuse existing behavior, types, and calculations where they satisfy the new
  contracts. Record intentional behavioral differences during migration.

## Architecture Invariants

### One shared runtime

- Backtest, sandbox, and live trading must execute through one shared runtime
  engine.
- Do not create separate entry, averaging, exit, re-entry, risk, accounting, or
  state-transition implementations for backtest and production.
- Environment differences belong behind explicit market, clock, execution,
  storage, and monitoring adapters.
- Avoid scattered mode checks such as `if (backtest)` or `if (live)` inside
  business logic. Select mode-specific adapters at the composition boundary.
- Backtest speed is a clock-adapter concern. It must not change logical cadence,
  event visibility, or strategy behavior.

### Strategy isolation

- Keep Multi, Hedge, and Streak rules inside strategy plugins.
- The runtime owns generic lifecycle, scheduling, risk authorization, order
  routing, execution application, persistence, and monitoring.
- A strategy owns its decisions, required market inputs, scheduling
  declarations, and strategy-specific state.
- Adding a future strategy must not require copying or rewriting the runtime.

### Result precision

- V1 measures only the final position result defined by the Precision backbone.
- Do not add input, decision, order-intent, or execution evidence solely for the
  V1 Precision Checker.
- Compare production and backtest only when period, strategy, configuration,
  and starting state are equivalent.
- Pair positions using the canonical key in `PRECISION_CHECKER.md`; report
  ambiguous or unpaired positions instead of guessing.

### Time and ordering

- Runtime behavior must use the injected logical clock. Business logic must not
  call `Date.now()` directly.
- Use the stage, account, symbol, and action ordering defined in
  `RUNTIME_ENGINE.md`. Ordering must not depend on promise completion, object-key
  order, filesystem traversal, or unseeded randomness.
- A position closed in the current unit of work cannot be averaged or closed
  again.

### Market-data visibility

- Never expose future market information in a backtest.
- At logical time `t`, only data with `observedT <= t` may be visible.
- Do not expose the final OHLC or volume of a forming candle before it was
  observable in production.
- Task cadence and market interval are separate. A one-minute task may inspect a
  five-minute candle, but only the snapshot visible at that minute.
- Missing required historical data must fail clearly. Do not silently fetch it
  from the network, substitute zero, reuse a future value, or search ahead.

### Runtime safety

- Backtest must be structurally unable to submit real orders or write live or
  sandbox state.
- Sandbox must not write live state or submit real orders.
- Live execution must be idempotent and recoverable across uncertain exchange
  responses.
- Persist an order intention before irreversible submission when required by
  the recovery design.
- Never log credentials, API secrets, or complete sensitive exchange payloads
  in ordinary monitoring data.

## Data and Persistence

- Use the canonical domain types from `docs/PRECISION/DATA_TYPE.md` across all
  runtime modes.
- Prefer one common position structure with a discriminated,
  strategy-specific state object. Do not build three incompatible position
  roots.
- Keep market evidence immutable. Account-specific usage such as consumed
  volatility points belongs in account strategy state, not on shared market
  objects.
- Every new persisted file format must have a schema version plus its strategy
  and runtime mode. Existing position files remain readable through migration.
- Preserve backward compatibility through explicit readers or migrations. Do
  not reinterpret an old field silently.
- All timestamps are Unix milliseconds in UTC.
- Percentage fields use percentage points unless a documented field explicitly
  uses a decimal rate.
- Apply exchange precision and rounding through one canonical numeric utility.
- Validate persisted data at storage boundaries. Treat JSON loaded from disk as
  untrusted input.

## Coding Style

- Prefer grouped APIs over scattered exported functions.
- When a module grows several related operations, expose an object shaped like:

```ts
const entity = {
  category: {
    //
  },
};

export default entity;

import entity from "./some/index";

entity.category.functionName();
```

- Avoid broad barrel exports for implementation modules because they encourage
  scattered imports. Do not expose module internals like this from an
  `index.ts`:

```ts
export * from "./service";
export * from "./storage";
export * from "./scheduler";
```

Prefer exporting the grouped public API plus explicit type exports when needed:

```ts
export { default } from "./entity";
export type * from "./types";
```

- Keep runtime core, adapters, strategies, canonical data types, persistence,
  comparison, and UI responsibilities behind clear module boundaries.
- Follow `docs/PRECISION/FOLDER.md` once a folder contract is defined. Do not
  invent a competing structure in implementation.
- Keep components and modules small and focused. Prefer composition over one
  large component or service.
- Always try to reuse existing types and functions before creating new ones.
- Add simple JSDoc for functions that compute something, especially pure or
  utility functions.
- Do not add JSDoc to React components unless it is genuinely needed.
- Prefer `condition && <Component />` for JSX conditional rendering instead of
  `condition ? <Component /> : null`.
- Do not introduce broad refactors while fixing a specific behavior.

## Efficiency and Storage

- Treat scalability as a correctness requirement, not a later optimization.
- Coordinate exchange and market-data requests across accounts where data can
  be safely shared.
- Bound concurrency and expose rate-limit, retry, error, latency, and cache
  measurements.
- Stream or process large market and evidence datasets in bounded chunks when
  possible. Do not load an entire multi-month dataset into memory without need.
- Performance optimizations must not change logical ordering, event visibility,
  or results.
- Prefer compact JSON for machine-owned persisted data. Use pretty-printed JSON
  only where human readability is required.
- Prefer short persisted field names where meaning remains clear:
  - Use `t` for generic time fields instead of `time` or `timeMs`.
  - Use `pct` for percentage fields instead of `percent`.
- Do not shorten names in public explanations or code when doing so makes the
  meaning ambiguous.

## Documentation Rules

- Keep every file under `docs/PRECISION` at or below 100 lines, except
  `_PRECISION.md`, which is the backbone and has no hard line limit. Prefer
  concise requirements and references to existing instances over duplicated detail.
- Keep `docs/PRECISION/_PRECISION.md` concise and high level. Put implementation
  details in the relevant detailed document.
- Use `must` for required behavior, `should` for a recommended default, and
  `may` for an allowed option.
- Keep terminology consistent across documents. Prefer the canonical names from
  `docs/PRECISION/DATA_TYPE.md`.
- Do not define incompatible copies of the same persisted type in multiple
  documents. If an interface is illustrative, label it as illustrative.
- When a contract changes, update every directly affected specification and
  cross-reference in the same change.
- Explain assumptions explicitly, especially candle visibility, clock timing,
  order fills, end-of-run behavior, and production comparison.
- Keep testing codes searchable and stable:
  - `PROD:` for production-only behavior.
  - `BTEST:` for backtest-only behavior.
  - `BOTH:` for shared behavior that must be tested in both flows.
- A shared `BOTH:` behavior must have evidence from both backtest and
  production-facing tests.

## Testing Scope

- Add or update tests when a change affects documented trading behavior,
  calculations, event ordering, scheduling, candle visibility, conditional
  flows, execution modeling, persistence compatibility, API contracts, or a
  known regression.
- Add the same `TC` comment to the implementation and the tests that prove the
  behavior.
- Test shared runtime behavior with more than one adapter composition. A unit
  test that exercises only backtest wiring is not sufficient proof of a
  `BOTH:` contract.
- Include deterministic fixtures for time, market observations, fills, fees,
  slippage, rejections, partial fills, and recovery where relevant.
- Add compatibility tests before changing persisted position, account, runtime,
  dataset, or evidence shapes.
- Do not add dedicated tests for trivial static or cosmetic edits unless they
  are tied to a documented contract or known regression.
- Do not change production code solely to make an unnecessary test possible.
- Even when a new test is not warranted, run the existing quality gate.

## Post-Implementation

- Re-think the change before finishing:
  - Does it follow the same core path in backtest, sandbox, and live modes?
  - Does it work for Multi, Hedge, and Streak where applicable?
  - Can backtest observe any information that production could not yet see?
  - Are decision, intent, execution, and state differences measurable?
  - Is event ordering deterministic?
  - Does persistent storage remain versioned and compatible?
  - Can a backtest or sandbox action reach live execution or live storage?
- Run:

```bash
npm run type
npm run quality
```

- For documentation-only changes, also run `git diff --check` and verify that
  referenced files and headings exist.
- If the repository does not yet contain the required package scripts, or a
  check cannot be run, explain why in the final response.
