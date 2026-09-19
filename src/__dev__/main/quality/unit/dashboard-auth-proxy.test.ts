import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";

describe("dashboard authentication proxy", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_PIN;
  });

  it("runs the authentication proxy for the dashboard root", () => {
    expect(config.matcher).toContain("/");
  });

  it("keeps the public coin metadata endpoint outside PIN authentication", async () => {
    process.env.DASHBOARD_PIN = "test-pin";

    const response = await proxy(
      new NextRequest("http://localhost/api/slow-trading/coin-metadata"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still protects coin metadata debug actions", async () => {
    process.env.DASHBOARD_PIN = "test-pin";

    const response = await proxy(
      new NextRequest(
        "http://localhost/api/slow-trading/debug/broadcast-coin-metadata",
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });
});
