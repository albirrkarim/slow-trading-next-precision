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
    this.helper = createRuntimeHelper(state);
  }

  async start() {
    await this.updateMarkPrice();

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
      await this.updateMarkPrice();
      await this.updateVPointsMap("1m");
      await monitoring.stages.speedup(this.context);
    }

    if (monitoring.schedule.isStandardDue(this.state)) {
      await this.updateMarkPrice();
      await this.updateVPointsMap();
      await monitoring.stages.standard(this.context);
    }

    if (monitoring.schedule.isCaptureEntryDue(this.state)) {
      await this.updateMarkPrice();
      await this.updateVPointsMap();
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

  /**
   * We will update the this.state.markPriceMap
   *
   * in this so later the child will be just accessing the context.state.markPriceMap
   * so letting know the latest price.
   */
  async updateMarkPrice() {}

  /**
   * Trying to keep the this.state.vPointsMap updated.
   *
   *  when speedup stage we use the 1m klines
   *  when usual condition we use the 5m klines
   */
  async updateVPointsMap(interval: "1m" | "5m" = "5m") {}

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
