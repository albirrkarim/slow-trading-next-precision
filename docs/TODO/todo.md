for the http://localhost:3010/dev/precision-checker

we trying to compare the live execution of the sandbox mode vs when it reply using the backtest method.

i think we need

in the production

http://localhost:3010/

i need to have record of the initial

```
vPointsMap
```

crop it about 1 month back.

so the tescase will be like

```ts
interface PrecisionTestCase extends BacktestTestCase {
  tradeHistory: Position[];
  /**
   * Used in precision checker test case
   */
  initialVPointsMap?: Record<string, VolatilityPoint<any>[]>;
}
```
