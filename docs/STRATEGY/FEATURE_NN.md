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

i plan to make v3 but it using Neural network

using training dataset of

c641dc191a3dcad0c5ed927ef80e99645c14a580637fdb602d1a0c49416e3b8f

and for testing is using

1f9966ef01ef820b553e0a583331506454fcf74bec3394f047df8d6e6ef0c438


I think NN tools will be on

src/lib/dev/nn

the training execution script will be on.

src/driver/*.ts

and the model weight and code will be on 

src/lib/strategies/default_with_features_gate/features/v3/*

i think we can before real inference (for test dataset) we doing warm up model to the memory first. then the looping starting right. and after the test dataset end loop we destroy the weight

# FAQ

1. Target

minimize the missScore ditribution and maximize acceptance number.

2. Gate behavior: does v3 replace v2 entirely, or run after v2 accepts a row?

keep existing v2, dont wireup the v3 yet into the strategy code. we test it based on the feature gate first.

3. Validation: can we reserve the latest portion of this training dataset for model/threshold selection, keeping the test coins untouched?

do it whats better

4. Minimum count: does your 600+ requirement mean accepted dataset rows or actual backtest trades? Those differ.

forget the 600 requirement. 


5. Trade-off: when higher acceptance worsens miss scores, should we prioritize lower scores, or report several thresholds with their quality/acceptance trade-offs?

The missScore must be below 3. so it will be 0-2

the sacrifice is must on the acceptance.

like trying the best acceptance but the missscore should below 3