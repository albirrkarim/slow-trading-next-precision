import {
  DYNAMIC_ALGORITM_MAP,
  EVALUATE_RECOMMENDATIONS_MAP,
  GET_RECOMMENDATIONS_MAP,
  evaluateRecommendations,
  getRecommendationsProduction,
} from "./algorithms";
import { getInvestmentAmount } from "./algorithms/v4/decisions/helper/runtime";

export type * from "./algorithms/type-execute";
export type { DecisionEngineVersionType } from "./algorithms/v4/decisions";

/**
 * Grouped brain/algorithm API for callers that need related decision helpers
 * without importing many standalone functions.
 */
const brain = {
  algorithms: {
    dynamicTrade: {
      map: DYNAMIC_ALGORITM_MAP,
    },
    recommendations: {
      evaluate: evaluateRecommendations,
      evaluationMap: EVALUATE_RECOMMENDATIONS_MAP,
      map: GET_RECOMMENDATIONS_MAP,
      production: getRecommendationsProduction,
    },
    runtime: {
      getInvestmentAmount,
    },
  },
} as const;

export default brain;
export { brain };
