function getAppName() {
  return String(process.env.APP_NAME ?? "unknown").trim() || "unknown";
}

function getServerName() {
  return `precision:${getAppName()}`;
}

function getInstructions() {
  return [
    `This MCP server controls the PRECISION app instance named "${getAppName()}".`,
    "Use balance_read for the canonical USDT balance object and its field meanings. Its totalAsset value is available plus locked margin, not floating equity or unrealized P&L.",
    "Before calling any write tool, show the user the exact draft change and ask for confirmation.",
  ].join(" ");
}

const runtimeMcpIdentity = {
  getAppName,
  getInstructions,
  getServerName,
} as const;

export default runtimeMcpIdentity;
