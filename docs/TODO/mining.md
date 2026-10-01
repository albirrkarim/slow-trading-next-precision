I need to have statistical approach

i need to block entry at level 1 when the sequence is goes to high level absolute 4 or more

so i need to know what feature when on the level 1 entry

so we can block. it before it goes to reaching high level

i belive it has something that we can distinguise to prevent that.

i need you to make data extraction -> learn from it think what feature can we use to prevent that.

also when the pricenorm history is too small you can extend it.


the output is we modifying the constanta or maybe new feature item / adjust existing

src/lib/strategies/default_with_features_gate

report back to me is it success and also how many good trades low level that being block because of the adjustment.



you can use this folder to do extraction

storage/analysis/case1/data.json


it will store like entry sequence
```
[
{
    entrySequence:VolatilityPoint[]
    featureOnEntry: {}
}
]
```