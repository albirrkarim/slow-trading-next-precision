# Folder Structure

This document defines the target source layout, module ownership, public API
boundaries, and allowed dependency directions for the Precision Trading System.

It replaces the overlapping `dynamic`, `slowTrading`, `trading`, `exchange`,
and `__dev__` boundaries found in the existing Multi, Hedge, and Streak
projects.

The architecture is defined by:

- `docs/PRECISION/_PRECISION.md`
- `docs/PRECISION/RUNTIME_ENGINE.md`
- `docs/PRECISION/DATA_TYPE.md`
- `docs/PRECISION/BACKTEST.md`
- `docs/PRECISION/PRECISION_CHECKER.md`

# A. Goals

The folder structure must make these boundaries obvious:

- One shared runtime for backtest, sandbox, and live modes
- Independent Multi, Hedge, and Streak strategy plugins
- Canonical domain types shared by every mode
- Explicit adapter contracts and replaceable implementations
- Backtest orchestration without duplicated trading logic
- Precision capture and comparison without UI-owned business logic
- Isolated generated state and evidence
- Tests organized by behavior and contract

A developer should be able to answer “where does this behavior belong?” without
searching several unrelated folders.

TC: `BOTH:MODULE_BOUNDARIES`

# B. Target project structure

```text
slow-trading-next-precision/
  AGENTS.md
  docs/
    PRECISION/
    SPECS/

  public/

  scripts/
    dataset/
    migration/
    maintenance/

  src/
    app/
      (dashboard)/
        page.tsx
        backtest/
          page.tsx
        precision-checker/
          page.tsx
      api/
        runtime/
        backtests/
        production-test-cases/
        precision-reports/

    components/
      ui/
      layout/

    features/
      production-dashboard/
      backtest-dashboard/
      precision-checker/

    domain/
      identity/
      market/
      strategy/
      order/
      execution/
      position/
      account/
      configuration/
      evidence/
      numeric/
      validation/
      index.ts

    runtime/
      contracts/
        strategy.ts
        market-adapter.ts
        clock-adapter.ts
        execution-adapter.ts
        storage-adapter.ts
        monitoring-adapter.ts
      engine/
      scheduler/
      cycle/
      risk/
      execution/
      accounting/
      state/
      recovery/
      monitoring/
      index.ts

    strategies/
      multi/
        config.ts
        state.ts
        decision/
        index.ts
      hedge/
        config.ts
        state.ts
        decision/
        index.ts
      streak/
        config.ts
        state.ts
        decision/
        index.ts
      index.ts

    adapters/
      market/
        live/
        historical/
      clock/
        real/
        simulated/
      execution/
        live/
        simulated/
          market-fill/
          limit-fill/
          fee/
          slippage/
          latency/
      storage/
        filesystem/
      monitoring/
        standard/
      index.ts

    infrastructure/
      exchanges/
        binance/
        okx/
        tokocrypto/
        index.ts
      filesystem/
      notification/
      hashing/

    persistence/
      codecs/
      repositories/
      migrations/
      paths/
      index.ts

    backtest/
      dataset/
        manifest/
        reader/
        validation/
        conversion/
      result/
      runner/
      index.ts

    precision/
      capture/
      integrity/
      normalization/
      compatibility/
      alignment/
        input/
        decision/
        intent/
        execution/
        result/
      scoring/
      divergence/
      report/
      index.ts

    composition/
      live/
      sandbox/
      backtest/
      index.ts

    config/
      environment/
      defaults/
      resolution/
      index.ts

  tests/
    unit/
    contract/
      strategies/
      adapters/
      runtime-modes/
    integration/
      runtime/
      backtest/
      precision/
      exchanges/
      persistence/
    end-to-end/
    fixtures/
      market/
      executions/
      runtime-state/
      production-test-cases/
      backtests/
      precision-reports/

  var/
    runtime/
      live/
      sandbox/
      backtest/
    datasets/
    production-test-cases/
    backtest-results/
    precision-reports/
```

Directories should be added when their first real module is implemented. Do not
commit empty placeholder trees merely to reproduce this diagram.

# C. Dependency direction

Dependencies must point inward toward canonical contracts and pure domain
logic:

```text
                         app / features
                                |
                                v
                         grouped public APIs
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
             composition                 precision
                    |                       |
          +---------+---------+             |
          |         |         |             |
          v         v         v             |
       runtime  strategies  adapters        |
          |         |         |             |
          +---------+---------+-------------+
                    |
                    v
                  domain

adapters ------> infrastructure
adapters ------> persistence
backtest ------> runtime + adapters + domain
composition ---> runtime + strategies + adapters + config
```

The arrows show allowed imports. Reverse imports are forbidden unless this
document is deliberately revised.

TC: `BOTH:MODULE_DEPENDENCY_DIRECTION`

## C.1 Allowed dependency table

| Module | May import | Must not import |
| --- | --- | --- |
| `domain` | Its own internal modules | Runtime, strategies, adapters, infrastructure, UI |
| `runtime` | Domain and runtime contracts | Concrete strategies, concrete adapters, Next.js, exchange clients |
| `strategies` | Domain and strategy contract | Concrete adapters, storage, exchange clients, UI, runtime engine internals |
| `adapters` | Domain, runtime contracts, persistence, infrastructure | UI and strategy implementations |
| `infrastructure` | External SDKs and its own low-level types | Strategies, runtime business logic, UI |
| `persistence` | Domain validation and filesystem infrastructure | Strategies, UI, mode-specific business rules |
| `backtest` | Domain, runtime public API, backtest adapters, config | Live exchange submission and UI components |
| `precision` | Domain, runtime monitoring contract, evidence readers, persistence | Strategy decisions, live order submission, exchange SDKs, UI components |
| `composition` | Runtime, strategies, adapters, config | Page components and route-specific presentation |
| `features` | Grouped application APIs and shared UI | Runtime internals, raw storage, exchange SDKs |
| `app` | Features, grouped server APIs, shared UI | Runtime internals and infrastructure details |

Enforce these rules with lint import restrictions once implementation begins.

# D. Module responsibilities

## D.1 `src/domain`

`domain` contains canonical, environment-independent data and pure rules:

- Runtime identity and version fields
- Market-event types and normalized market values
- Strategy decision and state envelopes
- Order intents, execution records, and fills
- Canonical account and position types
- Effective configuration types
- Evidence references and report data
- Numeric precision, rounding, fee, slippage, and PnL calculations
- Schema validation that does not perform I/O

Code in `domain` must be deterministic and side-effect free unless mutation is
strictly local to a newly created value. It must not read time, environment
variables, files, networks, or global mutable state.

`src/domain/index.ts` exposes one grouped domain API and explicit type exports.
Internal validators and calculation helpers remain private to their owning
submodule.

## D.2 `src/runtime`

`runtime` contains the one orchestration path shared by every mode:

- Runtime lifecycle
- Adapter and strategy contracts
- Logical scheduler
- Event ordering and dispatch
- Shared execution cycle
- Central risk authorization
- Intent persistence and routing
- Applying acknowledgements and fills exactly once
- Position, balance, fee, and PnL accounting
- Checkpointing, recovery, and idempotency
- Runtime monitoring events

The runtime may depend on interfaces from `runtime/contracts`, but never on a
concrete exchange, filesystem, strategy, simulated clock, or Next.js route.

Mode-specific checks do not belong in the engine. Live, sandbox, and backtest
behavior is selected through adapter composition.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

## D.3 `src/strategies`

Each strategy folder implements the same `StrategyPlugin` contract:

```text
strategies/
  multi/
  hedge/
  streak/
  index.ts
```

Each strategy owns:

- Its identifier and version
- Configuration validation and defaults specific to the strategy
- Strategy-specific account and position state
- Required market subscriptions
- Scheduling declarations
- Entry, averaging, exit, and re-entry decisions
- Stable decision reason codes
- Strategy diagnostics

Each strategy must export one assembled plugin from its `index.ts`. It must not
export its internal decision helpers broadly.

```ts
import multi from "./multi";
import hedge from "./hedge";
import streak from "./streak";

const strategies = {
  registry: {
    multi,
    hedge,
    streak,
  },
  get(strategyId: StrategyId): StrategyPlugin {
    // Validate and return a registered plugin.
  },
};

export default strategies;
```

The registry performs explicit strategy selection. It does not merge strategy
state or permit one strategy to import another strategy's internals.

Use these as migration sources for existing strategy behavior:

```text
Multi
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi

Hedge
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge/docs/slow/HEDGE/BOTH_DIRECTION_TRADING.md

Streak
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak/docs/slow/HEDGE/STREAK_BREAK_TRADING.md
```

Inspect the corresponding implementation and type comments as well as these
documents. Do not infer the complete strategy contract from one design note.

TC: `BOTH:PLUGIN_STRATEGY`

## D.4 `src/adapters`

`adapters` contains implementations of the runtime contracts:

- `market/live`: normalized market observations from exchange clients
- `market/historical`: as-of-time reads from immutable backtest datasets
- `clock/real`: wall-clock scheduling for live and sandbox modes
- `clock/simulated`: logical-time advancement for backtest
- `execution/live`: real exchange submission and reconciliation
- `execution/simulated`: reusable sandbox and backtest execution models,
  including market fill, limit fill, fees, slippage, and latency
- `storage/filesystem`: namespaced runtime-state persistence
- `monitoring/standard`: runtime measurements and diagnostics

Adapters translate external or mode-specific behavior into canonical runtime
contracts. They do not make strategy decisions or duplicate runtime accounting.

An adapter implementation may be shared by several modes through configuration.
Do not create three copies merely because live, sandbox, and backtest compose it
differently.

## D.5 `src/infrastructure`

`infrastructure` contains low-level integration code that does not know trading
strategy behavior:

- Exchange SDK clients and provider-specific request/response types
- Filesystem primitives
- Notification transports
- Hashing and compression implementations

For example, `infrastructure/exchanges/binance` knows Binance API shapes, while
`adapters/execution/live` converts the canonical `OrderIntent` to the selected
exchange client and normalizes the response.

Exchange-specific types must not leak into domain, runtime, strategies, or UI.

## D.6 `src/persistence`

`persistence` owns reusable durable-data behavior:

- Compact encoding and decoding
- Repository implementations used by storage and evidence modules
- Safe path construction
- Schema-version dispatch
- Backward-compatible readers and explicit migrations
- Atomic file replacement and recovery primitives

Persistence does not decide when to enter, average, exit, or schedule work.
Runtime behavior uses it only through the configured storage adapter or an
explicit evidence repository.

## D.7 `src/backtest`

`backtest` owns backtest-specific orchestration, not trading behavior:

- Dataset manifests, validation, streaming, and legacy conversion
- Backtest execution-model profile selection and validation
- Backtest runner composition
- Backtest result and evidence writing
- Cooperative cancellation and progress reporting

The runner constructs the shared runtime with historical market, simulated
clock, simulated execution, isolated storage, and monitoring adapters.

Entry, averaging, exit, risk, and position accounting must remain in the shared
runtime and selected strategy.

TC: `BTEST:BACKTEST_ADAPTER`

## D.8 `src/precision`

`precision` owns production evidence capture and read-only comparison:

- Starting, finishing, and canceling production test-case capture
- Evidence integrity and compatibility validation
- Canonical normalization
- Input, decision, intent, execution, and result alignment
- Tolerance profiles and separate category scores
- First-divergence and causal-chain analysis
- Immutable precision reports

`precision/capture` implements the runtime monitoring sink required to write a
production test case. The normal monitoring adapter may fan out canonical
events to this sink while capture is active. Capture must not create a second
runtime path.

The comparison code must not live in page components or backtest strategy code.
It reads canonical evidence and cannot mutate either source artifact.

TC: `BOTH:PRECISION_MEASUREMENT`

## D.9 `src/composition`

`composition` is the only place that assembles complete mode-specific runtime
instances:

```text
composition/live
  real clock + live market + live execution + live storage

composition/sandbox
  real clock + live market + simulated execution + sandbox storage

composition/backtest
  simulated clock + historical market + simulated execution + backtest storage
```

Every composition supplies a strategy plugin from the same registry. The
composition layer may select implementations, but it must not add alternative
trading phases or strategy rules.

Keep secrets and process-environment access at this outer boundary.

## D.10 `src/config`

`config` resolves environment, defaults, account settings, and strategy input
into one validated `EffectiveRuntimeConfig` before runtime startup.

- `environment` reads external values at the application boundary.
- `defaults` defines explicit versioned defaults.
- `resolution` merges and validates inputs into an immutable snapshot.

Runtime and strategies receive the snapshot. They must not read environment
variables or mutable configuration files directly.

## D.11 `src/app`, `src/features`, and `src/components`

- `app` defines Next.js routes, route handlers, layouts, and page entry points.
- `features` owns page-specific presentation, state, and client interactions.
- `components/ui` contains small reusable visual primitives.
- `components/layout` contains shared page structure and navigation.

Pages and route handlers remain thin. They call grouped public APIs from
backtest, precision, composition, or an application-facing service; they do not
reimplement strategy, scoring, execution, or persistence logic.

The initial routes are:

| Route | Feature owner |
| --- | --- |
| `/` | `features/production-dashboard` |
| `/backtest` | `features/backtest-dashboard` |
| `/precision-checker` | `features/precision-checker` |

Detailed page behavior belongs in `docs/PRECISION/PAGES.md` and the related
domain specification.

# E. Public API rules

Each major module exports one grouped API from its root `index.ts`:

```ts
import runtime from "@/runtime";
import strategies from "@/strategies";
import backtest from "@/backtest";
import precision from "@/precision";
import composition from "@/composition";

runtime.engine.create();
strategies.get("multi");
backtest.dataset.validate();
precision.comparison.run();
composition.live.create();
```

Use explicit type exports where consumers require types:

```ts
export { default } from "./runtime";
export type { RuntimeEngine, RuntimeOptions } from "./contracts";
```

Do not use broad implementation barrels:

```ts
// Forbidden
export * from "./engine";
export * from "./scheduler";
export * from "./storage";
```

Callers outside a module must not import deep implementation paths. Tests may
import an internal pure unit only when the unit is intentionally testable and
the import does not become application usage.

TC: `BOTH:GROUPED_PUBLIC_API`

# F. File ownership rules

Place a behavior according to who owns the decision:

| Behavior | Owner |
| --- | --- |
| “Should this strategy enter?” | `strategies/<strategy>` |
| “Is this decision allowed by shared risk?” | `runtime/risk` |
| “Which work runs first?” | `runtime/scheduler` and `runtime/cycle` |
| “Create an order intent” | `runtime/execution` |
| “Translate intent to Binance request” | `adapters/execution/live` plus Binance infrastructure |
| “Simulate this fill” | `adapters/execution/simulated` |
| “Apply this fill to a position” | `runtime/accounting` |
| “Read the latest historical candle as of time `t`” | `adapters/market/historical` |
| “Resolve runtime configuration” | `config/resolution` |
| “Encode or migrate persisted state” | `persistence` |
| “Capture production comparison evidence” | `precision/capture` plus monitoring adapter |
| “Align production and backtest decisions” | `precision/alignment/decision` |
| “Render the precision score” | `features/precision-checker` |

If code appears to belong in two owners, extract a canonical type or pure rule
into `domain`; do not copy the behavior into both folders.

# G. Generated data and storage isolation

Generated data must not be stored under `src` or mixed with test fixtures.

The logical runtime layout is:

```text
var/
  runtime/
    live/<account-id>/
    sandbox/<account-id>/
    backtest/<run-id>/
  datasets/<dataset-id>/
  production-test-cases/<test-case-id>/
  backtest-results/<run-id>/
  precision-reports/<report-id>/
```

Rules:

- `var` is machine-owned and excluded from version control.
- Live, sandbox, and backtest state roots are physically separate.
- A runtime mode receives its root explicitly; storage code must not infer it
  from a loose filename.
- Test fixtures live under `tests/fixtures` and are immutable during tests.
- Tests write temporary output to a unique temporary directory, never to a
  fixture or live root.
- Production test cases, backtest results, and precision reports use stable
  manifests with bounded evidence files and checksums.
- Secrets and complete protected exchange payloads do not belong in normal
  evidence or reports.

TC: `BOTH:STORAGE_MODE_ISOLATION`

# H. Testing structure

## H.1 Unit tests

`tests/unit` mirrors the source owner and covers pure calculations, validation,
normalization, decision rules, alignment, scoring, and migrations.

Example:

```text
tests/unit/
  domain/numeric/
  runtime/scheduler/
  strategies/multi/
  precision/scoring/
```

## H.2 Contract tests

`tests/contract` proves every implementation satisfies a shared contract:

- Each strategy satisfies `StrategyPlugin` behavior.
- Real and simulated clocks satisfy `ClockAdapter` behavior.
- Live and historical market adapters normalize equivalent evidence.
- Live and simulated execution adapters return canonical execution lifecycles.
- Filesystem storage preserves isolation, validation, and idempotency.
- Backtest, sandbox, and live compositions use the same runtime phases.

A `BOTH:` testing code must be exercised through both production-facing and
backtest-facing compositions.

## H.3 Integration and end-to-end tests

- `tests/integration/runtime` verifies adapter composition and state changes.
- `tests/integration/backtest` runs deterministic datasets through the shared
  runtime.
- `tests/integration/precision` captures, aligns, scores, and reports complete
  fixture pairs.
- `tests/integration/exchanges` verifies provider translation without leaking
  provider types into the domain.
- `tests/end-to-end` covers user-critical dashboard workflows.

Fixtures should be small and purpose-built. Large generated datasets and report
outputs do not belong in Git unless they are deliberately curated fixtures.

# I. Naming conventions

- Folder and file names use lowercase kebab-case.
- React components use PascalCase exports; their filenames may follow the
  repository's selected React convention consistently.
- Canonical persisted fields follow `docs/PRECISION/DATA_TYPE.md`; use `t` and
  `pct` where those compact names remain clear.
- Stable reason codes and error codes use uppercase snake case.
- Adapter implementations name what varies, such as `real`, `simulated`,
  `live`, `historical`, or a provider name.
- Do not use vague folders such as `helpers`, `misc`, `common`, or a catch-all
  `utils`. Put a utility next to its owner; move only truly shared pure rules to
  a named `domain` submodule.
- Do not use mode names such as `dynamic` or `slowTrading` as architectural
  boundaries. Use explicit runtime, backtest, strategy, and adapter ownership.

# J. Adding a strategy

To add a future strategy:

1. Create `src/strategies/<strategy-id>`.
2. Define its versioned configuration and state.
3. Implement the shared `StrategyPlugin` contract.
4. Declare required market subscriptions and scheduled work.
5. Emit canonical decisions and stable reason codes.
6. Register the assembled plugin in `src/strategies/index.ts`.
7. Add unit and strategy contract tests.
8. Run the same plugin through backtest and production-facing runtime contract
   tests.

Do not copy the runtime, adapters, backtest runner, position accounting, or
dashboard to add a strategy.

# K. Adding an exchange or adapter

To add an exchange:

1. Add its low-level client under `src/infrastructure/exchanges/<exchange>`.
2. Keep provider request and response types inside that folder.
3. Extend the relevant live market or execution adapter translation.
4. Normalize output into canonical domain types.
5. Add provider translation and adapter contract tests.

To add a new adapter implementation, implement an existing contract under the
matching `src/adapters/<kind>` folder. Change the contract only when the runtime
actually requires a new environment-independent capability.

# L. Migration mapping

The existing repositories must be decomposed by responsibility, not copied
folder-for-folder:

| Existing area | Target owner |
| --- | --- |
| `src/lib/dynamic/backtest-volatility/**` | Dataset/execution simulation to `backtest`; trading behavior to shared runtime or strategy |
| `src/lib/devBacktest/**` | `backtest/dataset`, scripts, or test fixtures according to responsibility |
| `src/lib/slowTrading/**` | Shared orchestration to `runtime`; I/O to adapters or persistence |
| `src/lib/trading/execute/**` | Intent flow to `runtime/execution`; accounting to `runtime/accounting` |
| `src/lib/trading/models/**` | Canonical types to `domain`; strategy-only fields to the relevant strategy |
| `src/lib/exchange/**` | Provider clients to `infrastructure/exchanges`; normalization to adapters |
| `src/lib/brain/**` | Strategy decisions to the relevant strategy; truly shared pure market calculations to domain |
| `src/lib/runtime/**` | Merge into the shared `runtime`, `config`, or `composition` owner |
| `src/lib/notification/**` | Transport to infrastructure; runtime notification policy to adapter/composition |
| `src/__dev__/main/quality/**` | `tests/unit`, `tests/contract`, `tests/integration`, or `tests/end-to-end` |
| `src/__dev__/storage/**` | Curated inputs to fixtures; generated state to `var` |
| Current dashboard components | `app`, `features`, or shared `components` according to ownership |
| Multi-specific behavior | `strategies/multi` |
| Hedge-specific behavior | `strategies/hedge` |
| Streak-specific behavior | `strategies/streak` |

Before moving a file, classify each exported function individually. A single
legacy file may need to be split across several target owners.

# M. Migration order

1. Establish canonical domain types and validation.
2. Establish runtime and adapter contracts.
3. Build the shared runtime engine and deterministic contract fixtures.
4. Add adapter implementations and mode composition.
5. Migrate Multi as the first strategy without copying legacy mode flows.
6. Run Multi through backtest, sandbox, and live-facing contract tests.
7. Migrate Hedge and Streak as plugins using the same contracts.
8. Add production test-case capture and precision comparison.
9. Move page behavior onto grouped application APIs.
10. Remove legacy duplicate paths only after parity evidence and storage
    migration are verified.

The temporary migration layer may read legacy storage or datasets. It must have
an explicit removal condition and must not become a permanent second
architecture.

# N. Review checklist

Before adding or moving a module, verify:

- Does it have one clear owner?
- Does it import only allowed dependencies?
- Is it shared behavior or strategy-specific behavior?
- Is a mode difference implemented through an adapter?
- Could it accidentally access live execution or storage?
- Does it duplicate a canonical type or calculation?
- Does it preserve deterministic event ordering and market visibility?
- Is its public API grouped and smaller than its implementation surface?
- Are persisted data and generated output outside `src`?
- Are relevant `TC` codes represented in the correct test layers?

# O. Related documents

- `docs/PRECISION/_PRECISION.md`
- `docs/PRECISION/RUNTIME_ENGINE.md`
- `docs/PRECISION/DATA_TYPE.md`
- `docs/PRECISION/BACKTEST.md`
- `docs/PRECISION/PRECISION_CHECKER.md`
- `docs/PRECISION/PAGES.md`
