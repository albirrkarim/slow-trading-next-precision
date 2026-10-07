# V3 neural feature gate

## Feature engineering

The encoder in [inputs.ts](./inputs.ts) builds **34 numerical features**:

- 8 features from the entry signal.
- 13 features from the signal's own coin.
- The same 13 features from BTC as market context.

It appends 34 presence bits, giving the network **68 input channels**.
Training and runtime inference use the same encoder and feature order.
The selected artifact uses the `legacy` profile described here. Earlier
artifacts without `inputProfile` keep this same preprocessing.

### Experimental directional profile

`--profile directional` enables 39 numerical inputs plus 39 presence bits,
implemented in [directional.ts](./directional.ts). It keeps signal side,
absolute and direction-aligned levels, percentage, log age, excursions and
signed signal/VWAP sigma distance. For both coin and BTC it computes:

- Direction-aligned normalized extrema, span and last change.
- Changes versus the last observation at least 6/24/72/168 hours earlier.
- Distance from the arithmetic trail mean and location inside its range.
- Signed mark/VWAP distance in sigma units and sigma as percent of price.

It also adds the observed BTC pivot's side alignment, absolute level,
percentage and log age; coin-minus-BTC extrema, sigma distance, 24/72-hour
changes; and the log coin/BTC volatility ratio. Future history/BTC pivots are
excluded, and unavailable lookbacks stay missing. This profile was compared
in cross-coin research but did not beat the selected legacy model under the
acceptance and score constraints. It is available for further training-only
experiments, not used by the selected weights.

### Signal features: 8

Here, `t` is the capture/decision time, `p` is the starting signal's price,
and VWAP readings belong to the signal's own coin.

| Feature | Calculation | Information supplied |
| --- | --- | --- |
| `side` | Bottom = `-1`; top = `1` | Signal direction |
| `level` | `signal.lvl` | Signed volatility-point level |
| `absoluteLevel` | `abs(signal.lvl)` | Level magnitude |
| `signalPct` | `signal.pct` | Detector's recorded percentage movement |
| `ageHours` | `(t - signal.t) / 3_600_000` | Age of the pivot at capture |
| `maxUpPct` | Captured `signal.maxUpPct` | Largest observed upward excursion since the point formed |
| `maxDownPct` | Captured `signal.maxDownPct` | Largest observed downward excursion since the point formed |
| `signalSigmaDistance` | `abs(p - vwap.price) / vwap.stdev` | Signal distance from monthly VWAP in standard deviations |

Excursions use the values already observed at capture. Subsequent price
movement does not enter the training input snapshot. Sigma distance is
missing when VWAP price or positive standard deviation is unavailable.

### Coin and BTC features: 13 each

Each row below appears twice, with prefixes `coin.` and `btc.`.
History means the captured `priceNormalized.history`, filtered to finite
timestamps/values with `point.t <= t`. Values retain their recorded order.

| Suffix | Calculation | Information supplied |
| --- | --- | --- |
| `norm` | `priceNormalized.current` | Latest pivot's location in the trailing pivot-price envelope |
| `last2` | Second value from the end of history | Recent envelope location |
| `last3` | Third value from the end of history | Earlier envelope location |
| `last5` | Fifth value from the end of history | Earlier envelope location |
| `min` | Minimum history value | Recent lowest envelope location |
| `max` | Maximum history value | Recent highest envelope location |
| `span` | `max - min` | Variation in envelope location |
| `mean` | Arithmetic mean of history values | Typical envelope location |
| `change` | Current normalized value minus first history value | Net displacement over the retained trail |
| `trailAgeHours` | `(t - firstHistory.t) / 3_600_000` | Duration covered by the trail |
| `distancePct` | Captured VWAP `distancePct` | Signed mark-price distance from monthly VWAP, as a percentage of VWAP |
| `stretchPct` | Captured VWAP `stretchPct` | Envelope width: `2 * stdev / vwap.price * 100` |
| `sigmaPct` | `vwap.stdev / vwap.price * 100` | Standard deviation relative to VWAP price |

`priceNormalized` expresses position in the runtime's roughly two-month
pivot-price envelope: 0 is its floor, 1 is its ceiling, and values can exceed
those bounds during breakouts.

The history is a trail of **value changes**, with roughly 20 days of retention.
Consequently, `last2`, `last3`, and `last5` are change-point lags with irregular
time spacing. They do not correspond to fixed candle counts or day counts.
The runtime may retain one older point when the reading stays unchanged.

History summaries are missing for an empty trail; lag features are missing
when the trail is too short. `sigmaPct` requires a positive finite VWAP price
and a finite, nonnegative standard deviation. The encoder reuses stored
`distancePct` and `stretchPct` values, including their upstream rounding.

## Scaling and missing observations

For each raw feature, the training tool fits a mean and population standard
deviation using its finite observations in the **fitting partition only**.
These values are saved in `model.json` and reused unchanged during inference.

```text
observed value = clamp((raw - trainingMean) / trainingStd, -8, 8)
missing value  = 0
presence bit  = 1 for an observed finite value, otherwise 0
```

An all-missing feature gets mean 0. Standard deviation falls back to 1 when
it is absent or no greater than `1e-8`. An observed zero keeps presence 1;
a missing observation has presence 0.

The final vector contains all 34 scaled values first, followed by their
34 presence bits in the same order.

## Input boundaries

The encoder uses the captured starting signal plus that coin's and BTC's
feature snapshots. Prices enter through percentages, normalized envelope
locations, or VWAP ratios. Timestamps enter through relative ages.

Excluded from the input vector:

- `missScore` and future sequence points.
- Future history observations.
- Symbol identity, point IDs, and `usedBy` bookkeeping.
- Absolute prices, calendar dates, shared-store values, and VWAP accumulators.

The symbol selects the appropriate coin feature object. BTC supplies market
context; BTC candidate rows are excluded from training and rejected by the
saved model's anchor-symbol policy.

The gate rejects invalid captures, including missing own-coin/BTC feature
objects, invalid signal label/level/price/time, or a signal timestamp after
the capture time. Optional missing readings use the presence channels above.

## Model output

The binary training target is `missScore >= 3`. The CPU MLP uses tanh hidden
layers and one sigmoid output: a risk ranking score between 0 and 1. Its
class-weighted training does not provide calibrated probabilities.

```text
allow = risk < savedThreshold
```

The current artifact uses one 8-neuron hidden layer. Its training-only
cross-coin cutoff multiplier is `0.2026439305243851`, producing a saved cutoff
of `0.03219368087262588`. The recorded test accepted just 6/3,647 rows: five
score-zero and one score-two. This passes the score constraint at very low
acceptance; it does not establish a 100% trading win rate.

The gate returns `{ allow, message }` for both outcomes. The message contains
the risk and cutoff comparison. Accepted strategy decisions save it into
`position.opened.message`.

These engineered features describe signal maturity, envelope position,
recent movement, VWAP stretch, and BTC context. Feature importance and
individual feature contributions have not been measured.

See the [training guide](../../../../dev/nn/README.md) for the driver commands,
dataset split, checkpoint selection, logs, and saved artifacts.
