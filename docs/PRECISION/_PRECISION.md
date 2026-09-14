# Precision Trading System

see what `TC` mean in `docs/SPECS/_SPECS.md`

# A. Problem

this is not precision result between backtest and the production runtime

`/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi`

because the backtest using volatility rails data and the production runtime is also feeded with klines 1 minute and 5 minute and theres speed up stage and standard monitoring stage.

that make the different.

Also the architechture is not Enterprise.

# B. Goals

One shared runtime engine that shared between production and backtest. Production and backtest must not contain separate trading logic. They use the same runtime and strategy code. Only their adapters are different.

see `docs/PRECISION/RUNTIME_ENGINE.md`

# C. Non - Goals

- We are not reinventing new trading strategy

# D. Meaning of Precision

What “precision” means and how it will be measured?

it mean it will as close as posible between backtest and the production.

it can be proved by number.

see the detail in `docs/PRECISION/PRECISION_CHECKER.md`

# E. System Architecture

I want it can flexible can accomodate:

- my 3 instance strategies. with some switch
- have good folder structure `docs/PRECISION/_PRECISION.md`
- one shared runtime engine `docs/PRECISION/RUNTIME_ENGINE.md`
- data types that can support our goals

# F. Migrations Plan

## 1. Folder structure

The current 3 instance folder structure is messy.

Plan good folder structure in `docs/PRECISION/FOLDER.md`

## 2. Plan position data types

Write the detail in `docs/PRECISION/DATA_TYPE.md`

- we have three instance with diferent strategy. think of what position json that can accomodate all of it.
- it can contain foot print needed for the `docs/PRECISION/PRECISION_CHECKER.md`
  for example we need to measure how fast the binance api execute order, so we need the time start and end right.

## 3. Planing runtime engine

`docs/PRECISION/RUNTIME_ENGINE.md` considering `docs/PRECISION/BACKTEST.md`
