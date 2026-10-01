export const EXCHANGE_COLOR_MAP: Record<string, string> = {
  binance: "#FCD535",
  okx: "black",
  tokocrypto: "#00C853",
};

/**
 * Fixed Y-axis width for the stacked backtest charts (Volatility Rails,
 * Price Normalized) so both plot areas start at the same x offset and the
 * time axes align — `width="auto"` sizes per-chart to its own tick labels.
 */
export const CHART_Y_AXIS_WIDTH = 40;
