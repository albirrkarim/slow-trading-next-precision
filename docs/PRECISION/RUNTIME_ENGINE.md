# Runtime Engine

One shared runtime engine that shared between production and backtest. Production and backtest must not contain separate trading logic. They use the same runtime and strategy code. Only their adapters are different.

TC: `PROD:RUNTIME ENGINE`

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

### Easy change adapter

I think of the runtime engine can be passed with some function or pack function maybe like

```
marketAdapter = {
    func1
    func2
}
```

we can switch the marketAdapter pack with the backtestMarketAdapter and productionMarketAdapter. the marketAdapter will be have same types.

TC: `BOTH:MARKET_ADAPTER`
