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

TC: `PROD:PLUGIN_BACKTEST`

the High-Level Overview of the backtest will be in `BACKTEST.md`

### It can be feeded with real data.

the engine can be plug with function to get / interact with real data from exchange.

TC: `PROD:PLUGIN_EXCHANGE`

### It can be use for many strategy.

currently we have 3 instance

```
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi
```

with the flexible runtime engine it can be just plug in with diferent strategy.

TC: `BOTH:PLUGIN_STRATEGY`

### It can be monitored.

Since the engine is have function as their params.

We can see the engine is calling some function many times. to see if it will causing api rate limit or not.

## B.2 The first thinking

I think of the runtime engine can be passed with some function or pack function maybe like

```
marketAdapter = {
    func1
    func2
}
```

we can switch the marketAdapter pack with the backtestMarketAdapter and productionMarketAdapter. the marketAdapter will be have same types.

TC: `BOTH:MARKET_ADAPTER`

## C. Benefit

- It can be used for finding the actual best configuration

## D. FAQ

- What “precision” means and how it will be measured.

TC: `BOTH:PRECISION_MEASUREMENT`

for example first we run runtime production.

we need button to start it "Start produce production test case" and "End produce production test case"

example i hit start from date 15 Sep 2026 to 20 Sep 2026

we got the trade history json right.

it will produce production test case like.

`prod-test-case/live-start-end.json`
`prod-test-case/sandbox-start-end.json`
`prod-test-case/[PRODUCTION MODE]-start-end.json`

```
startTime:
endTime:
config:{
    runtime,
    trading,
    etc..
} // all the config
tradeHistory:[]
```

then we need precision checker page `/precision-checker`

the job of the page will be "is the production execution is precise with the backtest?"
