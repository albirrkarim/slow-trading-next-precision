/**
 * Optional production host prefix.
 *
 * Empty string means "use same-origin relative URLs".
 */
export const PRODUCTION_DOMAIN = "";

/** Base API prefix for all application routes. */
export const API = `${PRODUCTION_DOMAIN}/api`;

/** Route family prefixes — names mirror the URL segments. */
export const SYSTEM_API = `${API}/system`;
export const MARKET_API = `${API}/market`;
export const DEV_API = `${API}/dev`;
export const PIN_API = `${API}/pin`;
export const MCP_API = `${API}/mcp`;
