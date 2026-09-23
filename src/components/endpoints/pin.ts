import { PIN_API } from "./constants";

export const pinEndpoints = {
  login: PIN_API,
  logout: `${PIN_API}/logout`,
} as const;
