# Multi Strategy Assessment

# Introduction

Read the
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-precision/docs/PRECISION/_PRECISION.md

Is this project are capable of accomodating the strategy of

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge/docs/slow/HEDGE/BOTH_DIRECTION_TRADING.md

and this

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak

Is the data type and RuntimeEngine APIs can able to accomodate that instance strategy.

I plan of making the

lib/strategies/both
lib/strategies/streak

and this system can be used as foundation, to accomodate strategy that build on top of it.

---

# Status (updated 2026-09-27)

**Implemented.** The multi-strategy contract, both strategy modules, and
every supporting engine/adapter/storage extension landed. Selecting a
strategy is `management.strategy` — resolved identically in backtest,
quick-backtest, the standalone driver, sandbox, and live through
`strategies.resolve` (`src/lib/strategies/index.ts`), which lazy-imports
the module into `new RuntimeEngine(state, adapter, strategy)`. An absent
slug keeps the built-in default pipeline unchanged; an unknown slug fails
loudly at engine construction.

## Landed

### Contract + engine

- **`StrategyAPI`** — `src/lib/strategies/types.ts`: `name`,
  `decisions.{entry,averaging,exit}.find`, `guard.allows`,
  `onActionResult`, `preflight`. `StrategySlug = "both" | "streak"`.
- **Engine wiring** — `RuntimeEngine(state, adapter, strategy?)` carries
  `context.strategy` on every `RuntimeContext`; stages swap
  `defaultDecision.<family>` for `strategy.decisions.<family>` when
  present, fire `strategy.onActionResult` after each action outcome —
  before env `onStateChange`/`onExit` persistence — and run
  `strategy.preflight` during `start()`.
- **Strategy-owned state slot** — `RuntimeEngineState.strategy?: unknown`;
  carried by `PrecisionRuntimeSnapshot` and the production test-case
  recorder, so replays reproduce strategy records.
- **Decision metadata slot** — `decision.strategy?: unknown` on every
  decision type; the entry commit copies it verbatim onto
  `position.strategy.logic` once, uniformly across environments
  (`monitoring/entry.ts`).
- **Pair decision + dispatch** — `RuntimePairEntryDecision`
  (`type: "pairEntry"`, `legs: RuntimeEntryDecision[]`) joins the
  `RuntimeDecision` union; `RuntimeEntryCandidate` covers
  `entry | pairEntry`. `executeDecision` dispatches `pairEntry` to the
  optional `adapter.onPairAction → Position[] | null`, commits each leg
  (push, `recordEntryBalance`, role-scoped `markVPointUsed`, `logic`
  stamp), fires `onActionResult` once per pair, and flushes state once.
  Adapters without `onPairAction` degrade cleanly: skip + logged warning +
  `onActionResult("failed")`.
- **Pair executor** — `src/lib/system/trading/pair-action.ts` runs legs
  sequentially and invokes `rollbackLeg` on already-filled legs when a
  later leg fails. Production rollback closes the leg live via
  `execution.closeLeg`; sandbox discards the uncommitted simulated fill.
- **Per-leg vPoint consumption** — `vPointUsage` +
  `VolatilityPoint.usedBy` markers (`"<slug>"` or `"<slug>:<ROLE>"`).
- **Decomposed guard** — `guard.common`, `guard.entry.{capacity,policy}`,
  `guard.averaging`; `strategy.guard.allows` replaces `guard.allows`
  wholesale at every checkpoint and recomposes the shared pieces.
- **`adapter.onActionEnvGuard`** — production's persisted-catalog
  `isActionAllowed` ANDs onto every decision.

### Config

- `management.strategy?: string` — global slug selection.
- `management.openDirection?: "ONE_WAY" | "BOTH"` — pair producers only
  emit when `"BOTH"`.
- `trading.entryLegs?: "MAIN" | "COUNTER" | "BOTH"` — per-account leg
  filter (default `BOTH`); affects future entries only.
- `trading.futuresPositionMode?: "ONE_WAY" | "HEDGE"` — passed into
  `getExchange` config so the Binance adapter sends `positionSide` and
  drops `reduceOnly` in hedge mode.
- All four keys are in `account-config.ts`'s flat↔split key lists, so the
  settings JSON editors and config persistence round-trip them.

### Persistence

- `runtimeStorage.strategy` — dedicated compact channel
  (`storageFiles.runtimeStrategyPath`), loaded in `createState` and
  flushed inside `onStateChange` alongside the existing channels.
- Production `onExit` flushes `state.strategy` (`persistStrategy` in
  `factory.ts`) right after `onActionResult`, so strategy bookkeeping
  (e.g. `pendingClose`) persists atomically with the close.

### Production / live

- `onPairAction` in `factory.ts`: live hedge-mode verification
  (`exchange.getFuturesPositionMode`) before the first leg — mismatch or
  probe failure notifies `tradeNotif.failed` and returns null; legs
  execute through `execution.entry` inside `runWithExchangeAccount`;
  rollback closes filled legs via `execution.closeLeg`; per-leg
  `tradeNotif.executed` notifications; state + strategy flush once.
- `execution.ts` resolves explicit `positionSide` (LONG→`"long"`,
  SHORT→`"short"`) under hedge mode and omits `reduceOnly` on closes.

### Strategy modules

- **`src/lib/strategies/both/`** — `decisions.entry` = shared pair
  producer (`shared/entry.ts findPairs`: collapses open pairs for
  pair-aware capacity, filters legs by `entryLegs`, emits one
  `RuntimePairEntryDecision` per signal). `decisions.averaging` = shared
  producer with `levelGate: "lowLevel"` for paired legs (exact next
  adverse step at ±1; no level skips). `decisions.exit` (`both/exit.ts`)
  = armed level-0 `VOLATILITY_TARGET_EXIT` (lvl-0 entries arm on the
  first non-zero level) → `pendingClose` cascade (sibling force-close
  with the originating reason) → shared evaluator with counter-leg
  `takeProfitPercent`/`useStopLossPlus` disabled until the profit-side
  level passes (`hasProfitLevelPassed`). `onActionResult` maintains
  `state.strategy.pendingClose` for `STOP_LOSS`/`STOP_LOSS_BY_USDT_LOSS`/
  `VOLATILITY_TARGET_EXIT` cascades. `guard` = `shared/guard.ts`
  (pair = one worker via `pairId` collapse, role-slot fill for
  `reopen` legs, shared `common`/`policy`/`averaging` delegation).
  `preflight` = hedge-mode declaration check per enabled account.
- **`src/lib/strategies/streak/`** — `decisions.entry` (`streak/entry.ts`)
  emits role re-entries from `state.strategy.roles` records (direction =
  opposite the survivor, anchor = newest confirmed vPoint after the
  survivor's entry not role-used, `reopen: true` meta, role-scoped
  `vPointUsage`, drift check + `record.reason` empty-slot status) then
  delegates fresh pairs to `findPairs`. `decisions.averaging` = shared
  producer with `levelGate: "adverse"` (any adverse-side point, level-0
  included). `decisions.exit` (`streak/exit.ts`) = direction-based rail:
  first confirmed post-entry TOP (LONG) / BOTTOM (SHORT) via
  `reserve.vpoints.findPositionTargetPoint` force-closes that leg only —
  no cascade — else the shared evaluator with TP%/SL+ disabled until the
  favorable-distance exception (≥ `VOLATILITY_THRESHOLD` from the latest
  vPoint). `onActionResult` maintains `roles` records. Same `guard` and
  `preflight` as `both`.
- **Shared helpers** — `strategies/shared/`: `pair.ts` (`PairLegMeta`
  validation, `buildId`, `roleMarker`, `findSibling`, `workerKey`,
  `collapse`), `entry.ts` (pair producer + funding pre-check via
  `entryAction.plan`), `guard.ts`, `close.ts` (forced-exit decision
  builder), `preflight.ts`, `state.ts` (versioned `state.strategy`
  accessor).

### Supporting extensions

- `tradingExit.findDecision(context, position, { config })` — shared
  evaluator accepts per-call config overrides (used for counter/TP
  gating without mutating persisted account config).
- `tradingAveraging.findDecision` + `generateRecommendations` accept
  `levelGate?: "lowLevel" | "adverse"` — the `|lvl| > 1` observation
  gate relaxes per strategy while the no-level-skip check stays.
- `tradingEntry.recommendation.make` exposed for strategy-built entry
  signals from arbitrary anchor vPoints.
- Notification maps include `pairEntry` (reuses the entry channel).

## Decided — Q&A (all implemented)

Every item below is decided and landed in the implementation described
under **Status**.

1. **Q — Add `config.strategy` for slug→module selection?** No config
   field exists yet and no call site passes a strategy — every
   `new RuntimeEngine(...)` runs with two args today (production
   `runtime.ts`, backtest `index.ts`, drivers).
   **A:** YES — `config.strategy: string`. Resolution lives in the
   adapter factories (lazy import per the proposal below) so
   backtest/sandbox/live resolve identically.
   **Landed:** `management.strategy` + `strategies.resolve` lazy-import
   called once per engine construction in `production/runtime.ts`,
   `backtestPrecision/backtest/index.ts`, `quick-backtest/index.ts`, and
   `driver/backtest-precision.ts`.

2. **Q — How does pair-aware entry eligibility land?**
   **A:** Decided — via `strategy.guard`. `lib/strategies/both/guard`
   replaces `guard.entry.capacity` with role-aware dedupe and pair
   counting ("worker count is not doubled"), delegating `guard.common` +
   `guard.entry.policy` for the rest. Pending the `both` module itself
   and the metadata it reads (item 4).

3. **Q — Atomic pair entry shape?** `onAction` returns `Position | null`
   today; pair entry needs two coordinated fills with rollback (close
   leg 1 if leg 2 fails). Options: **(a)** a `RuntimePairEntryDecision`
   type where `onAction` returns `Position[]` — rollback lives wholly in
   the adapter; **(b)** two leg decisions sharing `pairId`, executed as
   one atomic batch by the adapter — reuses the single-position pipeline
   but needs a batch/rollback protocol between engine and adapter.
   **Recommendation:** (a). Atomic operational behavior is the adapter's
   job per the boundary contract, and one decision = one trade intent
   keeps `onActionResult` and balance/vPoint bookkeeping honest per pair
   (each leg is still recorded individually from the returned array).
   (b) leaves the engine orchestrating compensation — a rollback concept
   leaking into strategy-neutral monitoring code. If keeping `onAction`'s
   signature stable matters, an optional `adapter.onPairAction` member is
   the narrower-diff variant of (a).
   **A:** (a)

4. **Q — Where do `pairId` / `role` / `entryLegs` live?** Decisions carry
   `vPointUsage` but no generic strategy payload; positions already have
   `strategy.entry.feature?: TFeature` (supersedes the earlier
   `Position.strategy.logic` sketch). Extend the same pattern — a
   free-form `decision.strategy`/`meta` slot the strategy types itself?
   **A:** Confirmed — `decision.strategy?: unknown` on the decision types
   (matching `state.strategy` / `position.strategy` naming) plus
   `position.strategy.logic?: unknown` as the landing slot. The engine
   copies `decision.strategy → position.strategy.logic` in
   `executeDecision`'s commit step after a successful `onAction` — once,
   uniformly across backtest/sandbox/live, so adapters never reimplement
   the copy. Falls out free: the strategy's `guard` reads
   `role`/`entryLegs` off the decision for pair-aware capacity,
   `onActionResult` correlates legs from decision + position, and
   `decisions.exit.find` reads `position.strategy.logic.pairId` for the
   counterpart lookup in item 5. Averaging/exit decisions use the slot
   only for producer→guard→callback correlation — no propagation.

5. **Q — Coordinated pair exit?** `monitorPosition`/`exit` handle one
   position per pass — `BOTH:VOLATILITY_TARGET_EXIT` /
   `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS` need either a pair-exit decision
   type or a post-exit counterpart lookup in `onActionResult` (safe —
   stages iterate a copied array).
   **Recommendation:** neither new machinery — same-pass producer logic.
   Stages iterate the pre-pass copy of `openPositions`, so the sibling
   leg is still visited this pass: when leg 1 closes, the strategy's
   `decisions.exit.find` on leg 2 sees the pair state (leg 1 closed, via
   the `pairId`/`role` metadata from item 4) and emits its exit in the
   same cycle. Zero new engine surface; the strategy owns pair semantics.
   Fall back to an explicit pair-exit decision only if one-tick ordering
   proves fragile in backtests.
   **A:** Confirmed — no new engine machinery. `decisions.exit` +
   `onActionResult` + `state.strategy` cover it, order-independent:

   - The monitoring loop iterates a snapshot copy
     (`for (const position of [...state.openPositions])`), while a close
     `splice`s the position out of the live array — so the sibling leg is
     always still visited that pass.
   - Same pass (sibling ordered after the closing leg): `both`'s
     `decisions.exit.find` sees the counterpart missing from
     `openPositions` (via `pairId` from item 4) and emits its exit
     immediately.
   - Any order: MAIN's `onActionResult("success")` writes
     `state.strategy.pendingClose[pairId]` — the strategy-owned flag —
     which runs **before** `onStateChange`, so it persists atomically
     with the close. COUNTER's next `exit.find` emits on the flag.
   - `onActionResult` for COUNTER's close clears the flag.
   - Replays reproduce it via `PrecisionRuntimeSnapshot`; a restart
     mid-pair-exit resumes it once item 7's `runtimeStorage.strategy`
     channel lands.

6. **Q — Config field placement?** `management.openDirection`
   ("ONE_WAY" | "BOTH"), per-account `trading.entryLegs`, and
   `futuresPositionMode` for hedge-mode validation are not in
   `RuntimeManagementConfig` / `RuntimeAccountTradingConfig` yet.
   Confirm names and locations?
   **Recommendation:** `management.openDirection` (engine-wide mode),
   `trading.entryLegs` per account ("MAIN" | "COUNTER" | "BOTH"), and
   `futuresPositionMode` on `RuntimeAccountTradingConfig` — it is an
   exchange-account property, not a management one, and `preflight`
   validates it per account at boot.
   **A:** yes


7. **Q — `state.strategy` persistence across restart?** The slot
   survives snapshots/replays but not a live engine restart —
   `createState` (`production/factory.ts`) rebuilds per-account state
   and never loads a persisted strategy record. Persist via a new
   `runtimeStorage` channel, or fold into the existing status file?
   **Recommendation:** a dedicated `runtimeStorage.strategy` channel —
   one compact file per mode (live/sandbox), read in `createState` like
   the status/vpoints bootstrap and flushed in the same `onStateChange`
   write. The status file has its own schema and lifecycle (daily-PnL,
   black-swan); strategy state is free-form `unknown`, so a separate
   channel keeps both schemas decoupled and replay snapshots identical.
   **A:** yes


## FAQ

**1. `onPairAction` vs. union return.** For item 3(a) there's a variant worth deciding now: keep `adapter.onAction(decision) → Position | null` single-position, and add a separate optional `adapter.onPairAction(pairDecision) → Position[] | null` — or widen `onAction`'s return to `Position | Position[] | null`. I lean toward `onPairAction`: the single-position invariant stays intact, adapters without pair support fail cleanly (undefined member → engine skips pair decisions with a warning), and existing env adapters don't churn. Preference?


A: yes introduce the adapter.onPairAction

```ts
// RuntimeDecision union gains a member:
type: "entry" | "averaging" | "exit" | "pairEntry"

// executeDecision — one dispatch point
const result =
  decision.type === "pairEntry"
    ? await context.adapter.onPairAction?.(decision, context) // Position[] | null
    : await context.adapter.onAction(decision, context);      // Position  | null
```


**2. Is the strategy global or per-account?** `StrategySlug`/`config.strategy` is currently modeled as one slug for the whole runtime. If an account should run `both` while another runs `streak` (or plain default), the config field belongs on `RuntimeAccountTradingConfig` and resolution becomes per-account — which changes how `preflight` and `state.strategy` partitioning work. If it's global forever, `management.strategy` is enough. Which?


A: the strategy is global, but each account can also be configured 

trading.entryLegs = "MAIN" | "COUNTER" | "BOTH"

**3. Hedge-mode: verify or set?** `preflight` can read the account's `futuresPositionMode` and refuse to boot — or should the system actively *set* hedge mode on the exchange at startup? I'd verify-and-refuse (mode flips can be rejected when positions are open, so silently setting is fragile) — confirm?

A: send some notif to enabled notification chanel

**4. `streak`'s contract surface.** Everything so far was designed against `both`'s known requirements. I haven't audited `slow-trading-next-streak` this session — e.g., whether its re-entry candidates need to bypass the vPoint signal path (`entrySignal`/`vPointUsage` are required-ish fields on entry decisions today) or need hooks beyond producers/`onActionResult`/`state.strategy`. I can review that repo and report gaps — want me to?

**A: Audited — contract covers it; no new engine surface.** Streak is the
pair-based reopen-loop variant (`STREAK_BREAK_TRADING.md`): MAIN/COUNTER
legs, close-and-reopen each favorable leg at the next confirmed unused
vPoint, per-leg independent stop loss, fresh pair when both legs die.

- Pair machinery + role metadata → items 3/4.
- Reopen loop → `decisions.entry` + `state.strategy` empty-role records.
- Role-scoped vPoint consumption (FAQ 8 `usedByMain`/`usedByCounter`) →
  `vPointUsage` already accepts `"<slug>:<ROLE>"` markers.
- "Newest confirmed unused vPoint" anchor (FAQ 7) → persist only the
  empty-role record (`{ pairId, role, blockedReason }`), resolve the
  anchor fresh at produce time — never store a staling anchor.
- Used-markers on fill only (FAQ 9) → already post-fill in commit.
- Per-leg SL, TP%/SL+ disabled, OR-rule exits (FAQ 5/6) → strategy
  `decisions.exit` composes the default producers minus those legs.
- `entrySignal` required → strategy constructs `EntryRecommendation`
  from its anchor vPoint; `vPointUsage` optional.

**One new open item:** empty-role slot visibility (streak C.1) — the UI
must show why an unfilled role is blocked. Recommend
`state.strategy.roles` (per-role status, persisted + replayable, same
flush as `pendingClose`) over extending `entry-diagnostics`, which
explains default-pipeline skips today.



**5. Rollout order confirmation.** My suggested sequence: types (`decision.strategy`, `position.strategy.logic`, pair decision type) → config fields + slug resolution → adapter pair execution → `both` module → `streak`. Any reordering, or implement all-in-one vs. staged commits?

all in one



# Human proposed architecture

Here my proposed architecure.

the production adapter will have port to be plugged with strategy API.

```tsx
interface StrategyAPI {
   onStrategy:OnStrategy
   onExit:OnExit
}
```

so the

lib/strategies/both
lib/strategies/streak

will be just exposing `StrategyAPI`

so in the production adapter we will have like 


const choosenStragey = [config.strategy] lazy import

so we plug choosenStragey.onStrategy  and choosenStragey.onExit into the production adapter

---

# Decided contract

The plug contract is defined in `src/lib/strategies/types.ts` (`StrategyAPI`)
and is wired into the shared engine: `RuntimeEngine(state, adapter, strategy?)`
carries it on every `RuntimeContext` (`context.strategy`), so stages swap
`defaultDecision.<family>` for `strategy.decisions.<family>` when present,
fire `strategy.onActionResult` after each `onAction` outcome (before the
env `onStateChange`/`onExit` persistence), and run `strategy.preflight`
during `start()`.

Review of the proposal above: the adapter seam and lazy import are right,
but `{ onStrategy, onExit }` alone under-covers the requirements — those
two are a veto gate and a post-close persistence hook. The contract drops
both and adds:

- `decisions` — per-family candidate producers mirroring
  `defaultDecision.{entry,averaging,exit}.find`. This is how a strategy
  *produces* decisions (both's MAIN+COUNTER pair, streak's re-entries).
- `onActionResult(result, decision, position)` — post-execution
  observation covering both outcomes: `"success"` carries the produced
  position (entries, averagings, and exits — a close is just a success
  whose `decision.type === "exit"`), `"failed"` carries `null`. Strategy
  bookkeeping commits on real fills, never on vetoed or failed
  candidates.
- `state` — dropped as a port; strategy-owned persisted records (e.g.
  streak pending re-entries) live in the free-form
  `RuntimeEngineState.strategy` slot, which `PrecisionRuntimeSnapshot`
  carries so test-case replays reproduce them automatically.
- `preflight` — optional boot validation (e.g. hedge-mode position-mode
  check) before the strategy's first pair entry.

`strategy.onStrategy` was dropped: a veto adds nothing the producer cannot
express — a strategy that wants to constrain a family it does not override
wraps `defaultDecision.<family>.find` and filters the result. Approval of
produced candidates stays environment-side (`guard.allows` ANDs with
`adapter.onActionEnvGuard`; strategies cannot disable account limits); a
close is observed through `onActionResult`; `onAction` is never
strategy-overridable.

---

# Remaining work

1. **Dashboard controls for the new fields** — DONE. Management tab:
   `Strategy` + `Open Direction` selects; account Trading tab (Entry
   group): `Entry Legs` + `Futures Position Mode` selects.
2. **Paired Open Positions (hedge C.1 + streak C.1)** — DONE. When
   `config.strategy` is `both`/`streak` and `openDirection` is `BOTH`,
   Open Positions renders `PairedOpenPositions` (`MAIN | coin net USDT |
   COUNTER` rows from `strategies/shared/board.ts`); otherwise the flat
   list is unchanged.
   - `both`: a leg that closes while its sibling survives is snapshotted
     into `state.strategy.closed[pairId]` (`PairClosedLeg`) and shown with
     a `Closed` chip until the pair fully closes; the coin net includes
     its realized PnL.
   - `streak`: every configured coin × participating account gets a row;
     an empty role shows `state.strategy.roles[pairId].reason` inline
     (producer drift/anchor waits, guard veto, failed re-entry); coins
     with no pair show the Entry Decisions reason via the shared
     `use-entry-diagnostics` store.
   - Manual exit targets one leg (`direction` on the manual-exit API).
3. **Entry diagnostics for strategy pipelines** — DONE.
   `StrategyAPI.diagnostics` (`view` + `explain`, read-only): pair
   strategies evaluate a pair-collapsed view and report `PAIR_OPEN`,
   `PAIR_ROLE_EMPTY` (streak re-entry reason), and
   `PAIR_FUNDING_INSUFFICIENT`.
4. **Integration verification on real data** — DONE for a 30-day
   quick-backtest (account `1` config, AAVE/LINK/MON/SUI/ZRO, futures,
   `maxOpenPositions` 8, 150 USDT, window ending 2026-09-27).
   Invariants checked on every closed leg: pair legs open together in
   opposite directions, one pair per symbol, concurrent pairs ≤ max,
   `both` stop/target cascades close the sibling with the same reason,
   `both` counter never TP/SL+ while MAIN is open, `streak` role legs
   never overlap, reopen direction is opposite the survivor, streak
   target exits close one leg only on the correct TOP/BOTTOM label, no
   streak stop cascade. **0 violations** for both strategies.
   - `both`: 59 pairs / 118 legs, +1.12%. MAIN mostly exits by SL+ (55);
     COUNTER by `VOLATILITY_TARGET_EXIT` (34). No stop-loss fired, so the
     stop cascade path is covered by unit tests only.
   - `streak`: 27 pairs, 32 reopens / 86 legs, +1.97%. Exits are led by
     SL+ (36, re-enabled by the favorable-distance exception) and
     `POST_AVERAGE_RESCUE_EXIT` (32); the rail target fired 8 times.
   - Observed config interaction (pre-existing, not strategy-specific):
     a fresh pair entered at ZRO `T[5]` and both legs closed one minute
     later by `EXIT_ON_VPOINT_LEVEL` because the account allows entries
     at levels ≥ `exitOnVPointAbsLevel`. Keep `maxEntryAbsLevel` below
     `exitOnVPointAbsLevel`, or add an entry guard for it.
5. **Backtest heap** — deferred (separate task). Year-long runs still need `npm run
   backtest:precision` (the standalone driver) or a raised
   `--max-old-space-size` under `next dev`; running long backtests in a
   child process is the proper fix.
6. **Sandbox hedge mode is modeled, not verified** — by design: sandbox
   simulates leg fills; live verifies the authoritative exchange position
   mode at preflight (configured-mode declaration) and again inside
   `onPairAction` before the first leg orders.
