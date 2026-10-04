# Testing Assessment

Scope: test suite structure, coverage, spec↔test traceability (TC markers),
isolation/mocking, integration depth, and automation. Verified against
`src/__dev__/main/quality/**`, `vitest.config.mts`, `package.json`, and the
`docs/SPECS/` TC-marker convention.

**Overall score: 69 / 100**

A serious, unusually disciplined suite for a solo project — 661 tests across
116 files, with a rare shared-engine parity layer and a spec-to-test marker
convention. The two structural holes: **no CI** (the quality gate only runs
when someone remembers to run it) and **loose marker hygiene** (95 of 169
specced behaviors have no marker-linked test, ~20 test markers are stale or
unspecced).

## Score breakdown

| Area | Score | Notes |
|---|---|---|
| Engine parity testing (backtest↔prod) | 18/20 | `quality/precision/` + `BOTH:` convention — the shared-engine property is directly tested, which most trading projects never do |
| Behavioral coverage (trading logic) | 14/20 | Substantial unit coverage across averaging/exit/entry/reserve/balance, but the marker gap means verified-behavior claims can't be trusted without reading tests by hand |
| Spec traceability (TC markers) | 10/15 | Convention is well-designed (spec → code → test); followed ~74/169 on the test side, ~139/169 on the code side, ~20 stale markers |
| API / route tests | 8/10 | 9 `specs/` files cover the key API surfaces (balance snapshots, klines, queue, withdrawal, sync) |
| UI / component tests | 8/10 | 33 files, jsdom + testing-library, real rendering not snapshots |
| Isolation & determinism | 5/5 | Per-process tmp storage root, sequential single-worker, no shared state — boring and correct |
| Integration / e2e | 3/10 | One real-exchange file (okx only); binance/tokocrypto dirs don't exist despite scripts; no e2e framework |
| CI / automation | 3/10 | `npm run quality` is a documented gate but runs manually only — no workflow enforces it |
| Coverage measurement | 0/5 | No `--coverage` run configured; holes are invisible |

## Strengths (verified in code)

- **The parity test suite is the crown jewel.** `quality/precision/`
  (multi-strategy, production-runtime-capture, sandbox-reset, black-swan
  timeline/config-refresh) exercises the same `precision` engine across
  modes — this is the single most valuable test category a trading bot can
  have, because backtest/live divergence is where bots die.
- **The TC-marker convention is real and mostly honored.**
  `docs/SPECS/_SPECS.md` requires `BOTH:`/`BTEST:`/`PROD:` markers in spec,
  code, and tests; ~139 of 169 spec TCs are marked in source, and 59 test
  files carry markers. This gives a human-auditable spec↔behavior map that
  most professional codebases lack.
- **Broad unit coverage of the risky code.** 65 unit files cover averaging,
  exit paths, reserve/balance math, notification dedupe, storage
  normalization, leverage, auto-remove — the places where money is lost.
- **API-level specs, not just unit tests.** `specs/` tests hit route
  handlers (queue-process, withdrawal-transfer, balance-snapshots, klines,
  storage-sync) — contract coverage, not only internals.
- **Real component tests.** 33 UI files render with jsdom +
  testing-library — behavior assertions, not snapshot churn.
- **Deterministic isolation.** `setupTests.ts` gives each process its own
  tmp storage root; `fileParallelism: false` + `maxWorkers: 1` + sequential
  order eliminates a whole class of flaky-state bugs. Full gate: ~61 s.

## Gaps

- **95 spec TCs have no marker-linked test** — and the missing set includes
  money-critical behaviors: `BOTH:ADAPTIVE_AVERAGING`,
  `BOTH:AVERAGING_IMPROVES_RESCUE_PROJECTION`,
  `BOTH:AVERAGING_STOPS_AFTER_TARGET_VPOINT`, `BOTH:WATCH_MECHANISM`,
  `BOTH:ADJUST_ENTRY_AMOUNT`, `BOTH:ENTRY_ONLY_IN_UNIQUE_VOLATILITY_POINT_ID`,
  `BOTH:ONLY_ONE_ACTIVE_POSITION_PER_COIN`,
  `BOTH:MAX_OPEN_POSITIONS_ENTRY_GUARD`, `BOTH:LEVERAGE_CALCULATION`,
  `BOTH:TRADITIONAL_TP_SL`, all five `BALANCE_*` buckets, and the monitoring
  stage TCs. Some are likely covered by unmarked tests — but per your own
  convention, unmarked means unverified.
- **Nothing enforces the convention.** No script checks spec↔test linkage,
  so markers drift: ~20 test-side markers reference TCs that don't exist in
  SPECS (`BTEST:RESULT_*`, `PROD:TRADE_HISTORY_CHART_COLLAPSE`,
  `BOTH:DAILY_TRADE_METRICS`, `BOTH:AUTO_REMOVE_*` variants…) — renamed or
  unspecced. (`PROD:HOLY`/`PROD:FAST`/`PROD:AUTO_REMOVE_` are test-data and
  comment false positives, not markers.)
- **No CI.** `quality` is a manual command; nothing runs it on push/PR. A
  broken rename or regression ships silently until someone runs it locally.
- **No coverage metric.** Without `--coverage` output there is no way to
  distinguish "untested" from "tested but unmarked" for those 95 TCs — the
  gap is currently anecdotal.
- **Integration is nearly absent.** One okx test file exists;
  `test:exchange:binance`/`tokocrypto` scripts run `--passWithNoTests`
  against empty dirs. Exchange-adapter behavior is effectively untested in
  CI terms (by design — they hit live APIs — but there's no recorded-fixture
  fallback).
- **No e2e.** No Playwright/browser-level check of the dashboard → API →
  storage path; the PIN auth flow and the dashboard polling loop have never
  been exercised end-to-end.
- **Serial-forever scaling.** Single-worker is correct for stateful tests,
  but the 2 h `testTimeout` exists for real-exchange calls — as the suite
  grows the whole suite inherits the slowest test's ceiling.

## To close the gap (prioritized)

1. **Add a TC-coverage check to `npm run quality`** — a ~30-line script:
   extract `(BOTH|BTEST|PROD):[A-Z_0-9]+` from `docs/SPECS/`, require each to
   appear in ≥1 file under `src/__dev__/main/quality/`. Fails the gate on
   new unmarked spec behavior *and* on stale test markers. This makes your
   existing convention self-enforcing — the cheapest high-value change here.
2. **Wire CI** — one GitHub Action running `npm run quality` on push. The
   suite is already deterministic and finishes in ~1 min; zero excuses not
   to.
3. **Run `vitest --coverage` once, scoped to `src/lib/system/trading/` +
   `src/lib/precision/`** — turns the 95-TC question from anecdote into a
   list; expect to find the averaging/entry-guard tests exist but unmarked.
4. **Backfill markers, not tests first** — where behavior is already tested,
   just add the TC comment; write new tests only where coverage is truly
   absent (entry guards, balance buckets, leverage).
5. **Purge stale test markers** — rename or delete the ~20 test-only TCs so
   the linkage stays honest.
6. **Adapter contract tests** — one recorded-fixture suite asserting the
   exchange-adapter interface shape (orders, positions, balance) so binance/
   tokocrypto get the same coverage okx has without live keys.
