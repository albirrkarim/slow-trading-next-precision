# Bounded cover strategy

`custom_gpt6_astra_bounded_cover_v1` uses the existing `both` pair entry,
exit, guard, diagnostics, and preflight behavior. It changes one decision:
an account with `maxEntryAbsLevel` will not average a position at a point
beyond that level.

## Handoff

The intended two-account config gives account 1 `minEntryAbsLevel: 2` and
`maxEntryAbsLevel: 2`, with `entryLegs: "BOTH"`. It opens paired legs at
level ±2 and cannot add to either leg at |level| ≥ 3. Account 2 has
`entryLegs: "MAIN"` and `minEntryAbsLevel: 3`, so it opens a one-way
mean-reversion position on a deeper wave. Both accounts still hold the
same symbol during the handoff, so losses remain correlated while the
wave continues.

## Config and rationale

The strategy reads `maxEntryAbsLevel` as the averaging cap. The shared
entry scan already enforces `minEntryAbsLevel` and `maxEntryAbsLevel` for
new automatic entries. Other trading settings, including reserve depth,
entry margin, leverage, exits, and manual-entry safeguards, retain `both`
behavior.

This tests whether the paired strategy's frequent realized closes can be
kept while moving deep-wave averaging to the cover account. Compare its
Daily Income profile score, refused averaging steps, effective capital,
and floating drawdown with the saved `both` entries. A reserved step beyond
the cap is intentionally never executed; size the shallow account for its
actual permitted steps.
