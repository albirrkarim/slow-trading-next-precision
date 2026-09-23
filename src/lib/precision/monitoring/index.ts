import entry from "./entry";
import manual from "./manual";
import position from "./position";
import schedule from "./schedule";
import stages from "./stages";

const monitoring = {
  entry,
  manual,
  position,
  schedule,
  stages,
} as const;

export default monitoring;
