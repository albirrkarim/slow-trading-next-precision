import { isDevBacktestEnabled } from "@/lib/env/devBacktest";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!isDevBacktestEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { default: precisionChecker } = await import(
    "@/lib/dev/precisionChecker"
  );

  try {
    if (req.method === "GET") {
      res
        .status(200)
        .json({ testCases: await precisionChecker.testCases.list() });
      return;
    }

    if (req.method === "POST") {
      const fileName = (req.body as { fileName?: unknown })?.fileName;
      if (typeof fileName !== "string" || !fileName) {
        res
          .status(400)
          .json({ error: "A precision test case fileName is required." });
        return;
      }

      res.status(200).json(await precisionChecker.run(fileName));
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Precision checker request failed.",
    });
  }
}
