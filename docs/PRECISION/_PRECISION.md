# Precision Trading System

see what `TC` mean in `docs/SPECS/_SPECS.md`

# A. Problem

this is not precision result between backtest and the production runtime

`/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi`

because the backtest using volatility rails data and the production runtime is also feeded with klines 1 minute and 5 minute and theres speed up stage and standard monitoring stage.

that make the different.

Also the architechture is not Enterprise.

# B. Goals

One shared runtime engine that shared between production and backtest.

The core principal:

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

## C. Non - Goals

- We are not reinventing new trading strategy

## D. Meaning of Precision

What “precision” means and how it will be measured?

it mean it will as close as posible between backtest and the production.

it can be proved by number.

see the detail in `docs/PRECISION/PRECISION_CHECKER.md`

## E. System Architecture

## E.1 Easy change adapter

I think of the runtime engine can be passed with some function or pack function maybe like

```
marketAdapter = {
    func1
    func2
}
```

we can switch the marketAdapter pack with the backtestMarketAdapter and productionMarketAdapter. the marketAdapter will be have same types.

TC: `BOTH:MARKET_ADAPTER`

# F. Migrations Steps

## 1. Folder structure

The current 3 instance folder structure is messy.

Plan good folder structure in `docs/PRECISION/FOLDER.md`

## 2. Plan position data types

we have three instance with diferent strategy. think of what position json that can accomodate all of it.
