import { DASHBOARD_UI_API } from "./constants";

export const precisionEndpoints = {
  capture: `${DASHBOARD_UI_API}/precision/capture`,
  compare: `${DASHBOARD_UI_API}/precision/compare`,
} as const;
