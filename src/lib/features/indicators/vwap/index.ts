import definition from "./definition";
import vwapMath from "./math";

/** Anchored VWAP indicator: math plus its registry definition. */
const vwap = { ...vwapMath, definition } as const;

export default vwap;
