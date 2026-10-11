import definition from "./definition";
import supertrendMath from "./math";

/** Supertrend indicator: math plus its registry definition. */
const supertrend = { ...supertrendMath, definition } as const;

export default supertrend;
