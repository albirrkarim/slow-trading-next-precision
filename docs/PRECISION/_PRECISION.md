# Precision Trading System

# A. Before

this is not precision result between backtest and the production runtime

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi

because the backtest using volatility rails data and the production runtime is also feeded with klines 1 minute and 5 minute and theres speed up stage and standard monitoring stage.

that make the different.

Also the architechture is not Enterprise.

# B. What i need

One shared runtime engine that shared between production and backtest.

## B.1 The core principal:

### It can be feeded with backtest dataset.

### It can be feeded with real data.

the engine can be plug with function to get / interact with real data from exchange.

### It can be use for many strategy.

currently we have 3 instance

/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi

with the flexible runtime engine it can be just plug in with diferent strategy.

### It can be monitored.

Since the engine is have function as their params.

We can see the engine is calling some function many times. to see if it will causing api rate limit or not.

## B.2 The first thinking

I think of the runtime engine can be passed with some function.

Architecture will be like

## C. Benefit

It can be used for finding the best configuration
