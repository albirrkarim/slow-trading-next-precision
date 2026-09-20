import { monitoring, runtimeSchedule } from "./monitoring";
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

  constructor(state: RuntimeEngineState, adapter: RuntimeEngineAdapter) {
    this.state = state;
    this.adapter = adapter;
  }

  async start() {
    const clock = this.adapter.clock;

    while (!(await clock.finished())) {
      const nextTime = runtimeSchedule.getNextTime(this.state);

      await clock.advanceTo(nextTime);

      this.state.currentTime = clock.now();

      await this.runDueStages();
    }
  }

  private async runDueStages() {
    if (runtimeSchedule.isSpeedupDue(this.state)) {
      await monitoring.stages.speedup(this.context);
    }

    if (runtimeSchedule.isStandardDue(this.state)) {
      await monitoring.stages.standard(this.context);
    }

    if (runtimeSchedule.isCaptureEntryDue(this.state)) {
      await monitoring.captureEntry(this.context);
    }
  }

  private get context(): RuntimeContext {
    return {
      adapter: this.adapter,
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
