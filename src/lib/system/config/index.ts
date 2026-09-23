/** Whether dev-only backtest endpoints are allowed to run. */
function isEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BACKTEST === "1" ||
    process.env.NEXT_PUBLIC_ENABLE_DEV_BACKTEST === "1"
  );
}

const systemConfig = {
  devBacktest: {
    isEnabled,
  },
} as const;

export default systemConfig;
export { systemConfig };
