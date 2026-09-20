import entry from "./entry";
import position from "./position";
import schedule from "./schedule";
import stages from "./stages";

const monitoring = {
  entry,
  position,
  schedule,
  stages,
} as const;

export default monitoring;
