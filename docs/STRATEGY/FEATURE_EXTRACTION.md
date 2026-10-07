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

with that method we can avoid overfitting, and learn real feature actually working.


## Dataset

on the backtest page i think we should have toggle like 

"also produce dataset" : boolean