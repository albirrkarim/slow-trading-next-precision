# Feature-gate v3 neural network

## Run it

```bash
# Train using only the configured training hash and export v3.
npm run nn:train

# Train, freeze the model/cutoff, then assess the separate test hash once.
npm run nn:train -- --test

# Test saved weights without retraining or overwriting the model.
npm run nn:test

# Compare features/networks on held-out training coins, then test the winner.
npm run nn:train -- --research --test

# Show every option and its default.
npm run nn:train -- --help

# Optional CPU PyTorch ensemble; the Python environment needs numpy and torch.
npm run nn:train -- --backend torch --python /path/to/python --test

# Example training-only experiment.
npm run nn:train -- --epochs 400 --seeds 17,29,43 --hidden 16,8 --log-every 5
```

Defaults come from `run.ts`: the training/test hashes specified in
`docs/STRATEGY/FEATURE_NN.md`, 180 maximum epochs, one hidden layer of width 8,
mini-batches of 64, Adam learning rate 0.003, L2 weight regularization 0.001,
seed 17, patience 40, the `legacy` feature profile, and cutoff multiplier
`0.2026439305243851`. These settings were selected using the training dataset
only. `--train-hash` selects another training run.
`--test-hash` selects a different final test and enables final testing.
Both hashes must differ. Training reads cached datasets; it does not run a
backtest or change its configuration.

The default command does **not** read the test hash. Use training-only runs
while choosing features and settings. After those choices are fixed, use
`--test` for the held-out assessment. Test results never update weights,
normalization, thresholds, or checkpoint selection. With a final test enabled,
failed candidates remain in their research folders and do not replace `--model`.

## Optional PyTorch ensemble training

Install `src/lib/dev/nn/requirements-torch.txt` in a Python environment and pass
its executable with `--python`. Runtime inference still uses TypeScript and
requires no Python packages. This backend trains one configurable network
family using every `--seeds` member, then averages their sigmoid scores.

Torch defaults: directional inputs, ReLU hidden widths 32/16, dropout 0.1,
Adam learning rate 0.003, weight decay 0.01, batches of 128, seeds 17/29/43,
150 epochs maximum, patience 35. `--activation`, `--dropout`, and
`--learning-target` configure Torch; ordinary architecture/optimizer/split flags
also apply. `--cutoff-margin` belongs to the native backend. With Torch,
`--research` compares eight families: widths 16/8 at weight decay 0.01 and
widths 32/16 at decay 0.001/0.01/0.05, each with learning targets >=1 and >=2.
Seeds, activation, dropout, epoch/optimizer/split settings apply to every
family. Selection maximizes the lower of cross-coin and full-training
acceptance rates; only the frozen winner is assessed against the final test.

The default learning target is `score >= 2`, to learn a stricter adverse-outcome
ranking. Selection and evaluation always enforce the actual `score < 3` rule.
Each training coin is held out in turn. Fit-only scaling and a purged latest-20%
validation split are shared across that fold's ensemble members. Checkpoints
maximize chronological validation acceptance below the lowest score-3+ risk
across that fold's training rows. The ensemble cutoff uses 90% of the minimum
unsafe held-out/training risk ratio, capped at 0.9. This is a training heuristic,
not a future-outcome guarantee. Every held-out training coin must retain rows.

`torch-input.json` records training-only observations once plus fit-only
normalization/indices for each fold, avoiding duplicate encoded datasets;
`torch-output.json` records seed checkpoints/predictions and Python library
versions. The TypeScript runtime audits accepted labels and verifies acceptance
parity with exported weights before saving a candidate. Final testing begins
only after saving frozen weights, normalization, and cutoff. Epoch logs stream
to the terminal and `training.log`; Ctrl+C terminates the Python worker.

For a fixed test copy, `--dataset-dir PATH` on `nn:train` or `nn:test` requires a
`manifest.json` containing `{cacheKey, files: {"SYMBOL.json": "SHA256"}}`.
Every file checksum and the cache key are verified. Reports include the actual
dataset fingerprint, model SHA256, and required acceptance floor.

## Cross-coin experiments

`--research` compares 12 predefined families: legacy/directional inputs with
linear, 8-neuron, and 16/8-neuron networks at L2=0.001; a 4-neuron network
at L2=0.01; and 8-neuron networks at L2=0.01/0.05. `--seeds` repeats the
entire family grid for each seed. Hidden widths/profile/L2 and the cutoff
margin are selected by the search; ordinary epoch/optimizer/split controls
still apply. `--hidden linear` also supports a single linear experiment.

Each training coin is held out completely in turn. Scaling, gradients,
checkpoint selection, and the baseline cutoff use the other coins with
the same purged chronological split. Held-out predictions are expressed
as risk divided by that fold's cutoff. The final multiplier is **half** the
lowest unsafe held-out ratio, capped at 0.5. This is a conservative heuristic,
not a statistical guarantee. Search requires nonempty acceptance from every
held-out training coin and from the full model's fitting/validation sets.
It maximizes combined held-out acceptance, breaking ties by lower mean score.
The multiplier is applied after checkpoint selection in both search and
single-model training.

`experiments.json` is updated after every experiment. Logs identify family,
seed, held-out coin, epochs, losses, cutoff, acceptance and qualification.
No test rows are read until the whole search finishes and one model is frozen.
With `--research --test`, a failed candidate stays in its research folder and
does not replace the active model. Without `--test`, a qualifying training
candidate is exported immediately. `nn:test` saves `evaluation.log` and
`report.json` without changing any model file. Success requires at least
**300 accepted, fully resolved rows**, with every accepted score below 3.
Low coverage, reject-all, score-3+ acceptance, and unresolved acceptance fail.

### Recorded result: 2026-10-07

Training-only search evaluated all 12 families with seed 17, epochs 180,
patience 40. Directional engineering and deeper/more regularized alternatives
did not beat the selected legacy 8-neuron network under these constraints.
Selected epoch: 14. Final cutoff: `0.03219368087262588`.

| Evaluation | Accepted | Accepted scores | Worst |
| --- | --- | --- | --- |
| Leave-one-training-coin-out | 32 / 6,146 | 0–2; mean 0.1875 | 2 |
| Full training runtime audit | 9 / 6,588 | 0: 8, 1: 1 | 1 |
| Frozen test runtime audit | 6 / 3,647 (0.16%) | 0: 5, 2: 1 | 2 |

The six-row result **fails the current 300-row requirement**. Six accepted
examples do not establish reliable future performance; missScore below 3 is
not equivalent to a profitable trade or a 100% win rate. The test hash had
already been assessed on the previous model; this is a benchmark on that
existing holdout, not a newly collected independent test. No test feature
rows were inspected or used to choose the new settings.

Search logs/reports: `storage/research/nn/cross-coin-2026-10-07/`.
Frozen test report: its `final-test/report.json`.
Training fingerprint:
`1d4545b5885bea4a05daaca0d81ef1f20f6dcc0a2c629fcd756d3810b4817774`.
Cache keys describe runs; changed dataset files can change results, so new
reports include dataset fingerprints and saved-model SHA256 hashes.

### Coverage research: current failures

| Frozen candidate | Accepted / test rows | Score 3 | Score 4 | Outcome |
| --- | --- | --- | --- | --- |
| Directional ReLU, one seed, loss target >=2 | 254 / 3,589 | 7 | 2 | Failed |
| Same family, three-seed mean | 317 / 3,589 | 7 | 2 | Failed |
| Same family, nine-seed mean | 344 / 3,589 | 7 | 2 | Failed |
| Training-selected four-seed subset | 355 / 3,589 | 7 | 2 | Failed |
| Seven training coins including TRX/DOGE | 147 / 3,589 | 0 | 0 | Failed: low acceptance |

The nine-seed artifact is reproducible with:

```bash
npm run nn:train -- --backend torch --python /path/to/python \
  --seeds 17,29,43,71,89,97,131,193,211 --test \
  --dataset-dir storage/research/nn/coverage-300-2026-10-07/test-snapshot \
  --run-dir storage/research/nn/my-nine-seed-run
```

Recorded reports are in `coverage-300-2026-10-07/`,
`coverage-300-ensemble-2026-10-07/`, and
`coverage-300-nine-seeds-2026-10-07/` under `storage/research/nn/`.
These candidates were not published. Their fixed test snapshot fingerprint is
`ab32db3bb17f9c3060bdaa7b3fcf956a5711d84a5aff15f3f5fcfb6d00160150`.
The cache changed between the earlier 3,647-row evaluation and this 3,589-row
snapshot; results from those copies are not interchangeable. The test hash is
now a repeatedly assessed benchmark, not a fresh independent holdout.

## Logs and saved files

The terminal displays timestamped progress with elapsed time. Every line also
goes to `storage/research/nn/<timestamp>-<pid>/training.log`. Use `--run-dir`
to choose a directory. Each run also saves:

- `report.json`: options, dataset fingerprint, split details, each seed's
  selected checkpoint, fitting/validation statistics, exact accepted score
  distributions, and optional final-test metrics.
- `model.json`: that run's frozen model, independent of subsequent runs.

The selected artifact is also written atomically to
`src/lib/strategies/default_with_features_gate/features/v3/model.json`.
`--model` changes this output path. A later successful training run replaces
this selected artifact; previous run copies remain in their research folders.

Epoch lines show weighted fitting loss, validation loss, the cutoff, fitting
and validation acceptance counts/rates, accepted mean/worst score, violations
of the score limit, an upper ETA to the epoch cap, and checkpoint improvements.
Every improvement is logged, in addition to the `--log-every` interval.
`--patience` stops a seed after that many epochs without objective improvement.
Ctrl+C stops at an epoch boundary and closes the log. Errors are written to
both the terminal and log.

Exit codes: `0` means successful training or a passing final test; `1` means
an execution/qualification error; `2` means the frozen model failed the
final-test score criterion; `130` means interrupted.

## Inputs and learning

This is a CPU MLP implemented in TypeScript: tanh hidden layers, one sigmoid
output, mini-batch backpropagation, and Adam. Its binary target is
`missScore >= 3`. Weighted cross-entropy gives unsafe examples class-balanced
importance. The resulting output is a **risk ranking score**, not a calibrated
probability.

Only capture-time inputs are used: the starting signal's label, levels,
percentage/age/observed excursions, its VWAP sigma distance, and its own coin
plus BTC's captured price-normalized history and VWAP readings. Symbol names,
absolute prices, absolute dates, future sequence points, `missScore`, and
`usedBy` are excluded from inputs. History points after capture time are
excluded. BTC remains an input anchor; BTC candidate rows are excluded from
learning and rejected by the v3 gate, so shared BTC rows cannot inflate the
cross-coin test.

Normalization is fitted on fitting rows only, then frozen. Every numerical
input has a separate presence bit; missing observations are not confused with
an observed zero. Normalized inputs are clipped at eight standard deviations.
Feature names/order and preprocessing are saved with the weights and validated
when loading an artifact.

## Chronological validation and selection

The latest 20% of usable training rows, with one shared timestamp boundary
across coins, are held out for validation. The fitting set stops one day
before that boundary by default (`--validation`, `--gap-hours`). Rows whose
labels were not available before the fitting boundary are purged from fitting.

Availability uses the capture time of the next recorded starting point at or
after the row's reversal as a conservative observation bound. A row without
such a recorded bound cannot enter fitting. The reversal's pivot timestamp
alone is insufficient because pivot confirmation occurs later.

Purged rows never affect normalization or gradient updates. Their labels,
which still belong to the **training hash**, are used only to tighten the
cutoff. The largest strict cutoff accepting no score-3+ row across the entire
training hash is computed at each checkpoint. Equal-risk ties are rejected.
Checkpoint selection maximizes validation acceptance, then favors lower mean
accepted scores, then higher fitting acceptance, then lower validation loss.

Both fitting and validation acceptance must be nonempty. Rejecting everything
is not a qualifying model. If no checkpoint qualifies, a report is saved and
no new model is published. Historical zero violations do not guarantee zero
violations on unseen data. The final test passes only with at least 300 fully
resolved acceptances and an actual accepted worst score below 3; otherwise it reports failure and
performs no automatic retuning.

## Feature-gate evaluation

`v3` appears in the existing feature-gate registry/UI/MCP list. Each evaluation
loads weights once, performs a dummy CPU forward pass to warm the execution
path, scores the dataset with the same frozen preprocessing, and disposes its
own session in `finally`. Disposal wipes the in-memory parameter arrays and
prevents further calls; it does not delete saved artifacts or affect another
evaluation's session.

The `default_with_features_gate` strategy now uses v3 in live, sandbox, and
backtest. Its `StrategyAPI.warmup` loads one model session before market
initialization; entry filtering and diagnostics use that same session.
`StrategyAPI.dispose` releases it on completion, abort, or startup failure.
Gate calls return `{ allow, message }`. V3 messages include the risk score and
its comparison with the frozen cutoff. The strategy copies an allowed message
into the entry decision, which is persisted as `position.opened.message`.
Sessions are keyed by each engine's helper object, so engines sharing a state
snapshot still own independent weights. One-shot manual/diagnostic engines
also warm their own session and dispose it after the task.

V2 remains available in the dataset gate registry. Changing the selected
artifact does not update a running engine: restart it to load the new weights.
`npm run build` copies the saved model into the standalone server's expected
runtime path. Every training backend saves its research candidate first.
With `--test`, publishing to the selected model path happens only after passing.
Without `--test`, a qualifying training candidate is exported immediately.

## Algorithm references

- [Adam paper](https://arxiv.org/abs/1412.6980)
- [MLP and feature scaling](https://scikit-learn.org/stable/modules/neural_networks_supervised.html)
- [Chronological validation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
