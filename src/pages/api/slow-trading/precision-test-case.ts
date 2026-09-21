import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";

type ResponseData =
  | Awaited<ReturnType<typeof production.precisionTestCase.getStatus>>
  | { fileName: string; path: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData | { error: string }>,
) {
  if (req.method === "GET") {
    const state = production.runtime.get().getState();
    res.status(200).json(await production.precisionTestCase.getStatus(state));
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
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
