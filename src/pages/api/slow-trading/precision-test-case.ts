import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import type { PrecisionTestCaseFileSummary } from "@/lib/production/precision-test-case";

type StatusOnly = Awaited<
  ReturnType<typeof production.precisionTestCase.getStatus>
>;

type StatusResponse = StatusOnly & { files: PrecisionTestCaseFileSummary[] };

type ResponseData =
  | StatusOnly
  | StatusResponse
  | { deleted: boolean; fileName: string }
  | { fileName: string; path: string };

function readFileName(req: NextApiRequest): string | undefined {
  const bodyValue = req.body?.fileName;
  if (typeof bodyValue === "string") return bodyValue;
  const queryValue = req.query.fileName;
  return typeof queryValue === "string" ? queryValue : undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData | { error: string }>,
) {
  if (req.method === "GET") {
    const state = production.runtime.get().getState();
    const [status, files] = await Promise.all([
      production.precisionTestCase.getStatus(state),
      production.precisionTestCase.files.list(),
    ]);
    res.status(200).json({ ...status, files });
    return;
  }

  if (req.method === "DELETE") {
    const fileName = readFileName(req);
    if (!fileName) {
      res.status(400).json({ error: "fileName is required." });
      return;
    }

    try {
      res
        .status(200)
        .json(await production.precisionTestCase.files.remove(fileName));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete the precision test case.";
      res
        .status(message.includes("not found") ? 404 : 400)
        .json({ error: message });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const runtime = production.runtime.get();
  const state = runtime.getState();
  if (!state) {
    res.status(409).json({ error: "Production runtime state is not ready." });
    return;
  }

  try {
    // PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
    if (req.body?.action === "start") {
      res
        .status(200)
        .json(
          await production.precisionTestCase.start(runtime.captureState()),
        );
      return;
    }

    if (req.body?.action === "end") {
      const result = await production.precisionTestCase.end(state);
      res.status(200).json({ fileName: result.fileName, path: result.path });
      return;
    }

    res.status(400).json({ error: "Action must be start or end." });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Precision test case failed.",
    });
  }
}
