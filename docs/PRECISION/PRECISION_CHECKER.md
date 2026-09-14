TC: `BOTH:PRECISION_MEASUREMENT`

for example first we run runtime production.

we need button to start it "Start produce production test case" and "End produce production test case"

example i hit start from date 15 Sep 2026 to 20 Sep 2026

we got the trade history json right.

it will produce production test case like.

`prod-test-case/live-start-end.json`
`prod-test-case/sandbox-start-end.json`
`prod-test-case/[PRODUCTION MODE]-start-end.json`

```ts
interface ProdTestCase {
  startTime;
  endTime;
  config: {
    runtime;
    trading;
    etc;
  };
  tradeHistory: [];
}
```

then we need precision checker page `/precision-checker` TC: `BTEST:PRECISION_CHECKER_PAGE`

the job of the page will be "is the production execution is precise with the backtest?"
