# Multi Strategy Assessment

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

# Answer

Yes. The foundation can accommodate both strategies — this is exactly the
"Version 2 (Flexible Strategy)" scope in `_PRECISION.md`. But the current
`RuntimeEngine` API and `Position` type need specific extensions first.

## What already fits

- **Adapter boundary is the right seam.** `RuntimeEngineAdapter`
  (clock/market/exchange/`onStrategy`/`onAction`/`onExit`/`onStateChange`) is
  the correct plug point. Hedge and Streak differences live behind it.
- **`openPositions: Position[]` is flat** — two legs (LONG+SHORT, same symbol)
  can coexist in state without structural change.
- **Role was already anticipated.** `_PRECISION.md` §D pairs positions by
  "normalized role... `MAIN`" — the Precision Checker spec assumes `role`
  will exist.
- **Exchange layer already supports `positionSide`**
  (`src/lib/exchange/types.ts`, binance/okx adapters) — hedge-mode order
  mechanics are mostly adapter-side work.
- **`usedBy<slug>` vPoint markers** exist as dynamic keys — extensible to
  per-leg granularity.
- **Both instance repos already converged on the same model**: `role`,
  `pairId`, `entryLegs` on `Position`; pair identity =
  `symbol + opened.vPoint.id + opened.t`
  (`hedge/src/lib/trading/both-direction.ts`).

## Gaps to close

### Data types (`src/lib/system/trading/types.ts`, `src/lib/system/runtime/types.ts`)

1. `Position` needs `role?: "MAIN" | "COUNTER"`, `pairId?: string`,
   `entryLegs?: "MAIN" | "COUNTER" | "BOTH"`. Trivial — all three already
   proven in the streak repo's model.


   
2. Streak needs a pending-reentry record (`PositionPendingReentry`:
   pairId/role/direction/anchor vPoint) — either a `state.pendingReentries`
   slot or strategy-owned state.
3. Config needs `management.openDirection` ("ONE_WAY" | "BOTH"), per-account
   `trading.entryLegs`, and `futuresPositionMode` for hedge-mode validation.
4. `usedBy<slug>` is a boolean per account — Streak needs per-leg marks
   (e.g. `usedBy<slug>` storing role), since one vPoint can be MAIN's
   averaging point and COUNTER's entry anchor.

### RuntimeEngine API (`src/lib/precision/`)

5. **One-position-per-symbol assumption** — `canAttemptEntry` blocks any
   same-symbol position. Needs pair-aware eligibility, and
   `maxOpenPositions` must count pairs ("worker count is not doubled"),
   not legs.
6. **Strategy can only veto, not generate.** `onStrategy(decision) => boolean`
   gates candidates produced by the built-in `defaultDecision`. A `both`
   strategy must *produce* pair entries; `streak` must produce re-entries.
   Widen the extension point to an injectable decision provider or a
   transform hook (`decisions => decisions`).
7. **`onAction` returns `Position | null`** — pair entry needs two
   coordinated fills with rollback (close leg 1 if leg 2 fails, per the
   hedge FAQ). Either a `RuntimePairEntryDecision` type returning
   `Position[]`, or two leg decisions sharing `pairId` executed atomically
   by the adapter.
8. **No coordinated exit** — `BOTH:VOLATILITY_TARGET_EXIT` and
   `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS` close both legs;
   `monitorPosition`/`exit` handles one position at a time. Needs a
   pair-exit decision or a post-exit counterpart lookup. (Iteration is
   safe — stages iterate a copied array.)
9. **No preflight hook** — hedge-mode validation
   (`PROD:VALIDATE_HEDGE_POSITION_MODE_*`) fits as an optional adapter
   method called during `start()` or before pair entry.

## On `lib/strategies/both` + `lib/strategies/streak`

Reasonable plan, consistent with the grouped-API convention. To make it
work, the engine should accept a strategy module shaped roughly like:

```ts
const strategy = {
  decisions: { entry, averaging, exit }, // candidate producers (default = current defaultDecision)
  gate,                                  // today's onStrategy veto
  positionState,                         // strategy-owned state init/serialization
};
```

`streak` can build on `both` (it is "hedge + leg re-entry" per its doc), so
`both` should expose the pair lifecycle primitives (`pair.matches`,
`volatilityTarget.resolve`, role resolution) that `streak` reuses —
mirroring how the instance repos share `both-direction.ts`.
