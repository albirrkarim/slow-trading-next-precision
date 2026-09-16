/**
 * Measurable API-call, duration, error, retry, and rate-limit usage for one
 * precision backtest run.
 */

/** Aggregated call statistics for one measured operation. */
export interface BacktestMetricCallStats {
  count: number;
  totalMs: number;
  errors: number;
}

/** Aggregated cycle statistics for one runtime stage. */
export interface BacktestMetricStageStats {
  count: number;
  totalMs: number;
  errors: number;
}

/** Immutable metrics snapshot persisted with a backtest result. */
export interface BacktestMetricsSnapshot {
  /** Total wall-clock duration of the run in milliseconds. */
  wallDurationMs: number;
  /** Logical run duration in milliseconds (endTime - startTime). */
  logicalDurationMs: number;
  /** Exchange adapter API calls grouped by method. */
  apiCalls: Record<string, BacktestMetricCallStats>;
  /** Runtime stage executions grouped by stage. */
  stages: Record<string, BacktestMetricStageStats>;
  /** Simulated order fills executed by the exchange adapter. */
  fills: number;
  /** Total measured errors across API calls and stages. */
  errors: number;
  /** Measured retry attempts. Always zero in V1 deterministic fills. */
  retries: number;
  /** Measured rate-limit usage. Always zero for the dataset-backed adapter. */
  rateLimitUsage: number;
}

/** Collects measurable API, stage, fill, error, retry, and rate-limit usage. */
export class BacktestMetricsRecorder {
  private readonly apiCalls: Record<string, BacktestMetricCallStats> = {};
  private readonly stages: Record<string, BacktestMetricStageStats> = {};
  private fillCount = 0;
  private retryCount = 0;
  private rateLimitCount = 0;
  private readonly startedAtWall = Date.now();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Measures one exchange adapter API call. */
  async trackApiCall<T>(
    method: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const stats = (this.apiCalls[method] ??= {
      count: 0,
      totalMs: 0,
      errors: 0,
    });
    const startedAt = this.now();
    try {
      return await operation();
    } catch (error) {
      stats.errors += 1;
      throw error;
    } finally {
      stats.count += 1;
      stats.totalMs += Math.max(0, this.now() - startedAt);
    }
  }

  /** Records one simulated order fill. */
  recordFill(): void {
    this.fillCount += 1;
  }

  /** Records a measured retry attempt. */
  recordRetry(): void {
    this.retryCount += 1;
  }

  /** Records measured rate-limit usage. */
  recordRateLimitUsage(): void {
    this.rateLimitCount += 1;
  }

  /** Measures one runtime stage execution. */
  async trackStage<T>(
    stage: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const stats = (this.stages[stage] ??= {
      count: 0,
      totalMs: 0,
      errors: 0,
    });
    const startedAt = this.now();
    try {
      return await operation();
    } catch (error) {
      stats.errors += 1;
      throw error;
    } finally {
      stats.count += 1;
      stats.totalMs += Math.max(0, this.now() - startedAt);
    }
  }

  /** Builds the immutable snapshot for this run. */
  snapshot(params: {
    logicalDurationMs: number;
  }): BacktestMetricsSnapshot {
    const errors = Object.values(this.apiCalls).reduce(
      (sum, entry) => sum + entry.errors,
      0,
    );
    return {
      wallDurationMs: Math.max(0, this.now() - this.startedAtWall),
      logicalDurationMs: params.logicalDurationMs,
      apiCalls: this.apiCalls,
      stages: this.stages,
      fills: this.fillCount,
      errors: errors + this.countStageErrors(),
      retries: this.retryCount,
      rateLimitUsage: this.rateLimitCount,
    };
  }

  private countStageErrors(): number {
    return Object.values(this.stages).reduce(
      (sum, entry) => sum + entry.errors,
      0,
    );
  }
}

const slowTradingBacktestMetrics = {
  recorder: BacktestMetricsRecorder,
} as const;

export default slowTradingBacktestMetrics;
export { slowTradingBacktestMetrics };
