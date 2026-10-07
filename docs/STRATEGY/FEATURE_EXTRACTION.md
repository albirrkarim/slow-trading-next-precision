# Method

With the same trading config.

We use old coin as the train dataset for making the feature rules

5 year

ADA, ETH, HBAR, SOL, XLM or other as many as posible so we can learn from it

then after it 

we have test dataset, its some 3 year at least

AAVE, LINK, SUI, XRP, ZRO

when tuning the feature we must not looking the test dataset feature.

when the benchmark using the test dataset are failed still big lose

so we need add more coins to the train dataset

with that method we can reduces overfitting, and learn real feature actually working.


## Dataset

on the backtest page i think we should have toggle like 

"also produce dataset" : boolean

i remember that when the new vpoint formed we have that event on the RuntimeEngine onNewVPoint

it capture the open dataset then we wait.

make the onEntryCapture(context) before the entry capture hapen

so when it fired we collect the features and save it to the open dataset.

Capture features once, at the first entry-capture event after the starting point appears. Later capture events must not overwrite that snapshot.

then we wait until the level sequence formed and closed the open dataset, then save it.

Keep multiple pending rows per symbol if every point gets a dataset row. For B₀ → B₋₁ → B₋₂ → T, the three starting bottoms produce scores 2, 1, and 0, and all close when T appears.

it will save dataset to the 

`storage/cache/backtest-precision/[hash]/dataset/[symbol].json`

the dataset will be like 

```tsx
interface Dataset {
    // get from the state.currentTime when entry capture hapen
    t: number

    /**
     * Scoped only the current vpoint symbol + BTC,
     * pruned like pruned feature we use to saved to the position json
     */
    feature,

    /**
     * Vpoint sequence until break
     * from current vpoint -> to the destination / reversal
     * 
     * For example
     * 
     * Level 0 B -> Level -1 B -> Level -2 B -> Level 0 T (this is the destination)
     * 
     * B->B->B->T
     * 
     * So this field will hold
     */
    sequences: VolatilityPoint[] 

    /**
     * How bad when we entry on this point.
     * How next level before reverse
     * 
     * From the example "sequences" above
     * 
     * we can have score of 2 (we have two B Bottom)
     * 
     * so lower are better
     */
    missScore: number,
}
```

Before it pass like this 
```tsx
export default function featureGateV2(
    context: RuntimeContext,
    symbol: string,
    signal?: VolatilityPoint,
): string | undefined 
```

i think we should modify into this, because all that we need is this.

focused into the feature understanding

```tsx
export default function featureGateV2(
    currentTime: number,
    features: RuntimeFeatures,
    signal: VolatilityPoint,
): string | undefined 
```

## UI

on the 
http://localhost:3010/dev/backtest-precision

we already have backtest result. i think better make tabs on the top

[backtest result][dataset]

so the dataset tab will have like 

paginated table 

[time][feature][level sequence][missScore][debug]
use the feature preview component

debug column will have button dialog, to show the dataset json.

i need it have filtering tools, maybe based on the

also on the top

we have list of the features gate versions that we have

maybe this `src/lib/strategies/index.ts` can expose the list of it

so i can select feature gate version to test.

i think we need to make new api and code in src/lib/dev/feature-gate

it will takes only 

- backtest hash (later i can manual switch between train/test dataset)
- the feature gate slug

and it will doing inference. and i think it will result fast.

I need to ask how we doing the evaluation?

Report these metrics

Acceptance rate: accepted rows / all rows.
Accepted quality: accepted score-zero rows / accepted resolved rows.
Good opportunities retained: accepted score-zero rows / all score-zero rows.
Bad opportunities blocked: rejected score-positive rows / all score-positive rows.
Accepted score distribution: counts for scores 0, 1, 2, 3+, plus average and worst score.