import definition from "./definition";
import emaMath from "./math";

/** EMA indicator: math plus its registry definition. */
const ema = { ...emaMath, definition } as const;

export default ema;
