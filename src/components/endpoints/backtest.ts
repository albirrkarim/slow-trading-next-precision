import { DASHBOARD_UI_API } from "./constants";

export const backtestEndpoints = {
  dataset: `${DASHBOARD_UI_API}/backtest/dataset`,
  run: `${DASHBOARD_UI_API}/backtest/run`,
} as const;
