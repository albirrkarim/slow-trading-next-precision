import averaging from "./averaging";
import entry from "./entry";
import exit from "./exit";

const defaultDecision = { averaging, entry, exit } as const;

export default defaultDecision;
