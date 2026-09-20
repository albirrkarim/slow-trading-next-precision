import entry from "./entry";
import schedule from "./schedule";
import stages from "./stages";

const monitoring = {
  entry,
  schedule,
  stages,
} as const;

export default monitoring;
