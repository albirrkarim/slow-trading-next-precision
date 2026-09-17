import { decisionEngineV20 } from "./v20/decision";

export { decisionEngineV20 as decisionEngine } from "./v20/decision";

export const DECISION_ENGINE_MAP: Record<string, typeof decisionEngineV20> = {
  // Direct entry at the configured minimum absolute level
  "decision.v20": decisionEngineV20,
} as const;

export type DecisionEngineVersionType = keyof typeof DECISION_ENGINE_MAP;
