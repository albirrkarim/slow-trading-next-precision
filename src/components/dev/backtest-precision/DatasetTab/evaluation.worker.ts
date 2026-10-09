import clientFeatureGate from "@/lib/dev/feature-gate/client";
import type { ClientEvaluationInput, ClientEvaluationResult } from "@/lib/dev/feature-gate/client";

export type EvaluationMessage = { result: ClientEvaluationResult } | { error: string };

self.addEventListener("message", (event: MessageEvent<ClientEvaluationInput>) => {
  void clientFeatureGate.evaluate(event.data)
    .then((result) => self.postMessage({ result } satisfies EvaluationMessage))
    .catch((error) => self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies EvaluationMessage));
});
