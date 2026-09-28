# `src/components` Organization Plan

## Goal

Make component ownership clear without changing trading behavior or doing one
large move. Move a feature only when its imports and tests can move with it.
Keep the client endpoint registry aligned with `src/pages/api/`.

## Current inventory (2026-09-28)

`src/components` has 183 files: 130 in `LiveDashboard/`, 24 in `ui/`, 18 in
`dev/`, 6 in `endpoints/`, 2 in `client/`, and 3 at the root. The large
`LiveDashboard/Feature/` folder mixes entry, positions, volatility, queues,
logs, and quick backtest. Settings already has useful tab folders under
`LiveDashboard/Navbar/Settings/`; preserve those groupings during migration.

The folder names currently hide several dependencies:

- `src/pages/api/market/klines.ts` imports `LiveDashboard/converter` and
  `LiveDashboard/Shared/trade-chart-markers`. Server code should use pure
  modules from `src/lib`, never a component folder.
- `ui/Chart/*` imports marker types from `LiveDashboard/converter`; generic
  chart components should own or import neutral chart types.
- Live dashboard screens import `dev/Coins/*`, while backtest and precision
  checker import dashboard settings, reports, charts, and helpers. Shared UI
  should have a neutral home rather than belong to one screen.
- `Navbar/useLiveDashboardNavbar.ts` imports the entry diagnostics store from
  `Feature/`. That store is shared dashboard state, not a visual panel.

## Proposed destination

```text
src/components/
  dashboard/
    DashboardPage.tsx
    navigation/          # navbar and dashboard controls
    entry/               # entry decisions, sequences, quick backtest
    positions/           # open positions, paired rows, funding display
    volatility/          # latest points and frequency views
    queues/              # queue panel and dialogs
    logs/                # runtime log panels
    state/               # dashboard-only hooks/stores
  settings/              # dialog, draft types/helpers, existing tab folders
  reports/               # reports shared by dashboard and dev pages
  charts/                # domain charts and marker/series presentation
  coins/                 # coin tags and metadata UI used outside dev pages
  dev/
    backtest-precision/
    precision-checker/
  ui/                    # reusable visual primitives, no trading knowledge
  endpoints/             # client API URL registry mirroring pages/api
```

This is a destination map, not an instruction to create every folder now.
Keep a module beside its only caller until there is a reason to share it.
Move pure calculations and server-consumed models to the appropriate
`src/lib/system/**` or `src/lib/dev/**` boundary, rather than to `ui/`.
Keep `src/components/client/` until its color constants and scheduling helpers
have clear owners; do not rename it just for symmetry.

## Component modularity

Treat a React component file above roughly 500 lines as a prompt to review its
responsibilities. Currently 18 component-area TypeScript files exceed that
size; examples include `DailyPnlCalendarDialog.tsx`, `SlowTradingLogs.tsx`,
`LiveDashboardPage.tsx`, and `TradesTableSection.tsx`. For each, look for
independent UI sections that can become small local components, reusable
state/effects that belong in a focused hook, and pure calculations that belong
outside React. Keep closely related markup together when splitting would add
more indirection than clarity. The line count is a review trigger, not a hard
limit or a reason to create one-file-per-fragment components.

When a component is actually split into multiple related files, give it a
folder named after the component. Keep its main component, private
subcomponents, hook, and local types together, for example:

```text
SlowTradingLogs/
  index.tsx               # public component
  LogRow.tsx              # local subcomponent
  useSlowTradingLogs.ts   # local state and effects
  types.ts                # types used only by this feature
```

The `index.tsx` file should expose the main component only; do not turn it
into a broad barrel for internal files. A component that remains one cohesive
file does not need its own folder.

When splitting a file, preserve state ownership, effect timing, rendering
conditions, props, and tests. Separate the component split from relocating
the feature to its final destination so a behavior change is easier to spot.

## Migration sequence

1. **Record the baseline and untangle non-visual dependencies.** List current
   imports from `src/pages/api/` into `src/components/`, then extract the
   pure converter and trade-marker logic to `src/lib`. Put chart marker types
   where both charts and server code can import them. Update callers and
   existing tests together. No API route should import a component path.
2. **Give shared UI neutral owners.** Move `dev/Coins/*` items used by the live
   dashboard to `coins/`. Move reporting views used by both live and dev to
   `reports/`; move reusable trade charts and level-sequence presentation to
   `charts/` or `positions/` according to their callers. Move the settings
   dialog and its existing tab folders together so the backtest page does
   not depend on a navbar path. Keep `ui/` for context-free controls only.
3. **Split the dashboard by user task.** Move one coherent group at a time
   from `LiveDashboard/Feature/`: entry, positions, volatility, queues, then
   logs. Move the corresponding hook, local types, and small utilities with
   each group. Put `use-entry-diagnostics` and its shared refresh store under
   `dashboard/state/`, with entry panels and settings importing that public
   module. Keep `DashboardPage` as composition, not a source of domain logic.
4. **Finish dev ownership.** Once shared dependencies have neutral homes,
   keep backtest-only screens under `dev/backtest-precision/` and checker-only
   screens under `dev/precision-checker/`. Update app pages and tests to the
   new paths. Remove emptied folders only after searching for remaining
   imports and dynamic references.

For each step, move files with their callers in a reviewable batch. Update
imports directly; avoid broad `index.ts` re-exports or long-lived compatibility
wrappers. Preserve component behavior, props, client/server boundaries, and
the endpoint registry key-to-URL mapping. Do not move trading calculations
into React modules while reorganizing their views.

## Completion checks

- Every component has one obvious owner; dashboard and dev screens share
  neutral modules instead of importing each other's screen folders.
- Files above roughly 500 lines have been reviewed for separable components,
  hooks, and calculations; any remaining large file has one coherent role.
- `ui/` and `src/pages/api/` have no imports from dashboard or dev component
  paths. `endpoints/` remains the only source of client API URLs.
- Searches for old import paths and hardcoded `/api/` literals in components
  return no newly introduced references.
- After every batch, run `npm run type` and `npm run quality`. Smoke-check the
  dashboard, settings Save, open-position diagnostics, reporting, and the dev
  backtest/precision pages affected by that batch. A pure file move needs no
  new test; add or update tests when behavior or an API contract changes.
- Recheck the applicable live, sandbox, backtest, and storage boundaries if a
  batch moves logic rather than presentation. The behavior specifications in
  `docs/SPECS/` remain authoritative.
