- i need to have button that can replace local mac full persistent storage, with the online version.

data is sent through export api, so i can just do one click and the background will sync between this online server and local on my macbook.

on `https://precision.reinventwp.com`

so the reproduce bug will be easier.

AI agent (you) can hit that api, when i ask you to debug about the online data.

Behavior:

- Online server exposes a persistent-storage export API.
- Every dashboard server has a sync API/button that can clone persistent storage
  from another dashboard server into the current server.
- The sync fetches the source server export, writes it into a staging directory,
  creates a timestamped backup of the current server's persistent storage, then
  replaces the current persistent storage with the source version.
- The replace action is available outside localhost so one deployed server can
  clone another. It remains protected by dashboard authentication, requires an
  explicit confirmation in the UI, and creates a backup before replacement.
- The export API remains protected by dashboard auth and can also accept `SYNC_TOKEN` for server-to-server sync.
- The button is in Settings > Runtime > Debugging.

TC: `PROD:SYNC_ONLINE_TO_LOCAL`

## Backtest trade chart averaging

When a closed-trade chip is opened from the backtest monthly report, the trade
chart receives the selected persisted position. The chart displays the initial
entry at `opened.price`, one labelled circular marker at the time and price of
every persisted `strategy.averaging.executions` item, and a dashed horizontal
line at `exposure.averageEntryPrice`. After averaging, the line is labelled
`Avg Entry`; otherwise it is labelled `Entry`.

The selected trade's entry and averaging markers are supplied only by the
position-aware chart layer so they are not duplicated by the surrounding
historical markers.

Above the chart, the review displays an explicit `Not averaged` status or the
number of averaging executions followed by one debug record per execution. It
also reuses the production level-sequence chips. Because backtest exit history
contains a pre-close position snapshot, the review copy may recover its exit
level from the existing exit message; this enrichment is display-only and does
not modify the simulation result.

TC: `BTEST:BACKTEST_TRADE_CHART_AVERAGING`


## Feature gate dataset and inference

TC: `BTEST:FEATURE_GATE_DATASET`

With `produceDataset` enabled, each detected vPoint starts a pending row.
The first scheduled `onEntryCapture` after formation freezes the capture time,
pruned symbol + BTC features, and the starting signal's then-observed runtime
fields in `sequences[0]`. Later captures must not overwrite these inputs.
Other same-label points extend every pending sequence; its first opposite
point closes it with `missScore = sequences.length - 2`. All pending rows
remain independent, yielding scores 2, 1, 0 for B → B → B → T.
Rows persist as compact arrays in `dataset/<symbol>.json` within the backtest
cache. Unfinished sequences have no score. Rows closed before any capture
remain inspectable but are skipped by inference, as are invalid capture inputs
or resolved labels. The report exposes a skipped count; the five evaluation
metrics use evaluable rows only, and score metrics exclude unresolved rows.
Inference uses the same pure gate as runtime, with currentTime, pruned features,
and the frozen starting signal. Future sequence points and missScore are not
passed to the gate. Gate refactoring must preserve existing trading thresholds.
The dataset table and report both follow the selected dataset hash, and an old
report must not appear under a different hash or gate selection.

TC: `BOTH:FEATURE_GATE_INPUTS`

The dataset UI places the table on the left and gate selection, evaluation
control, and metrics on the right, stacking on narrow screens. Table columns
are Time, Feature, Level sequence, Miss score, and Debug. Feature cells reuse
the trade feature preview, with the dataset's frozen starting signal supplied
for signal age and VWAP sigma distance. Each Debug button opens the complete
dataset row in the shared JSON tree dialog. The evaluation panel explains how
to show metrics before the first evaluation and displays the five metrics after
Evaluate completes.
