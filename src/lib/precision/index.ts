import type { RuntimeEngineAdapter, RuntimeEngineState } from "./types";

/**
 * This runtime is used on both in backtest and the production
 * BOTH:SHARED_RUNTIME_ENGINE
 */
class RuntimeEngine {
  [key: string]: any;

  state: RuntimeEngineState;

  adapter: RuntimeEngineAdapter;

  constructor(state: RuntimeEngineState, adapter: RuntimeEngineAdapter) {
    this.state = state;
    this.adapter = adapter;
  }

  start() {}

  standardStages() {
    // for each position that lastmonitoredis = standard
    // do monitoring
    // this.monitoring;
    // also check criterion so the position might moved to speedup stages
  }

  speedupStages() {
    // for each position that lastmonitoredis = speedup
    // do monitoring
    // this.monitoring;
    // also check criterion so the position might moved to standard stages
  }

  monitoring() {
    // Shared market data. the latest price etc..
    // then the data Consumed by
    // this.averaging(data);
    // this.exit(data);
    // this.updateBalance;
  }

  captureEntry() {
    // trying to entry
    // updating the volatility points
    // on strategy feeded with the latest volatility points
    // const decision = await this.onStrategy(this.state, vpointsMap);
    // maybe the decision
    // const result = await this.onAction()
  }

  averaging() {
    // trying to do averaging
    // telling outside todo something, maybe real execution etc
    // const result = await this.onAction();
    // from the result we record back to internal runtime engine stage
    // is success?
    // is it changing the position data
    // is it closed the position
    // is it live mode?
    // if yes we need to call exchange update balance
    // if not we do the calculation to update the balance with the current trade result.
  }

  exit() {
    // trying to do exit from the open position
    // using the config and the exit rules/ conditions we decide the exit.
    // telling outside todo something, maybe real execution etc
    // const result = await this.onAction();
    // from the result we record back to internal runtime engine stage
    // is success?
    // is it changing the position data
    // is it closed the position
    // is it live mode?
    // if yes we need to call exchange update balance
    // if not we do the calculation to update the balance with the current trade result.
  }

  updateBalance() {
    // foreach accounts
    // const balanceAccount = this.exchange.getBalance;
  }

  // used in production
  updateConfig() {
    // update config to the state and storage
  }
}

export { RuntimeEngine };
