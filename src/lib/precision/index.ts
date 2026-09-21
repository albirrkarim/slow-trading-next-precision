import { tradeLog } from "../trading";
import { createRuntimeHelper, type RuntimeHelper } from "./helper";
import monitoring from "./monitoring";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "./types";

/**
 * This runtime is used on both in backtest and the production
 * BOTH:SHARED_RUNTIME_ENGINE
 */
class RuntimeEngine {
  state: RuntimeEngineState;

  adapter: RuntimeEngineAdapter;

  helper: RuntimeHelper;

  constructor(state: RuntimeEngineState, adapter: RuntimeEngineAdapter) {
    this.state = state;
    this.adapter = adapter;
    this.helper = createRuntimeHelper(state, adapter);
  }

  async start() {
    if (!this.state.config.runtime.runnerEnabled) {
      return;
    }

    tradeLog.log("RUNTIME ENGINE STARTED");

    await this.helper.market.updateMarkPrice();
    await this.helper.market.updateVPointsMap();

    const clock = this.adapter.clock;

    while (!(await clock.finished())) {
      const nextTime = monitoring.schedule.getNextTime(this.state);

      await clock.advanceTo(nextTime);

      this.state.currentTime = clock.now();

      await this.runDueStages();
    }
  }

  private async runDueStages() {
    if (monitoring.schedule.isSpeedupDue(this.state)) {
      await this.helper.market.updateMarkPrice("1m");
      await this.helper.market.updateVPointsMap("1m");
      await monitoring.stages.speedup(this.context);
    }

    if (monitoring.schedule.isStandardDue(this.state)) {
      await this.helper.market.updateMarkPrice();
      await this.helper.market.updateVPointsMap();
      await monitoring.stages.standard(this.context);
    }

    if (monitoring.schedule.isCaptureEntryDue(this.state)) {
      await this.helper.market.updateMarkPrice();
      await this.helper.market.updateVPointsMap();
      await monitoring.entry.capture(this.context);
    }
  }

  private get context(): RuntimeContext {
    return {
      adapter: this.adapter,
      helper: this.helper,
      state: this.state,
    };
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
