import { PRODUCTION_DECISION_ENGINE } from "@/components/constants";
import type {
  EntryRecommendation,
  EntryRecommendationEvaluation,
} from "./type-execute";
import { executeDynamicTradeV4 } from "./v4";
import {
  evaluateRecommendationsV20,
  getRecommendationsV20,
} from "./v4/decisions/v20/recommendations";

export const DYNAMIC_ALGORITM_MAP = {
  "dynamic.v4": executeDynamicTradeV4,
} as const;

export type DynamicTradeAlgorithm = keyof typeof DYNAMIC_ALGORITM_MAP;

type RecommendationResult =
  | EntryRecommendation[]
  | Promise<EntryRecommendation[]>;
type RecommendationParams = Parameters<typeof getRecommendationsV20>[0] &
  Record<string, any>;
type RecommendationEvaluator = (
  params: RecommendationParams,
) => EntryRecommendationEvaluation | Promise<EntryRecommendationEvaluation>;

export const GET_RECOMMENDATIONS_MAP: Record<
  string,
  (params: RecommendationParams) => RecommendationResult
> = {
  "decision.v20": getRecommendationsV20,
} as const;

export const getRecommendationsProduction =
  GET_RECOMMENDATIONS_MAP[PRODUCTION_DECISION_ENGINE];

export const EVALUATE_RECOMMENDATIONS_MAP: Record<
  string,
  RecommendationEvaluator
> = {
  "decision.v20": evaluateRecommendationsV20 as RecommendationEvaluator,
} as const;

/**
 * Evaluates recommendations through the selected decision engine and includes
 * diagnostics when that engine supports them.
 */
export async function evaluateRecommendations({
  decisionEngineVersion,
  ...params
}: RecommendationParams & {
  decisionEngineVersion?: string;
}): Promise<EntryRecommendationEvaluation> {
  const version = decisionEngineVersion ?? PRODUCTION_DECISION_ENGINE;
  const evaluator = EVALUATE_RECOMMENDATIONS_MAP[version];
  if (evaluator) {
    return evaluator(params);
  }

  const getRecommendations =
    GET_RECOMMENDATIONS_MAP[version] ?? getRecommendationsProduction;
  return {
    diagnostics: [],
    recommendations: await getRecommendations(params),
  };
}
