# Specification

## Testing codes

`TC` means testing code. A TC is written as a comment in both the production
calculation and its test so future changes can find the behavior and its proof.

- `PROD:` identifies behavior in the production/runtime leaderboard flow.
- `BTEST:` identifies backtest-only behavior.
- `BOTH:` identifies behavior shared by production and backtest flows and must
  be tested in both.

This project has no backtest flow, so its current TCs use `PROD:`.
