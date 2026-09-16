import type { NextApiRequest, NextApiResponse } from "next";
import precision from "@/lib/precision";

function parseMode(value: unknown): "live" | "sandbox" | undefined {
  return value === "live" || value === "sandbox" ? value : undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") {
      const [status, testCases] = await Promise.all([
        precision.capture.status(),
        precision.capture.list(),
      ]);
      res.status(200).json({ status, testCases });
      return;
    }

    if (req.method === "POST") {
      const action = String(req.body?.action ?? "");
      const mode = parseMode(req.body?.mode);
      const account = req.body?.account
        ? String(req.body.account)
        : undefined;

      if (action === "start") {
        const started = await precision.capture.start({ account, mode });
        res.status(200).json(started);
        return;
      }

      if (action === "end") {
        const ended = await precision.capture.end({ mode });
        res.status(200).json(ended);
        return;
      }

      res.status(400).json({ error: "action must be start or end" });
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    res.status(500).json({
      error: error?.message ?? "Failed to manage precision capture",
    });
  }
}
