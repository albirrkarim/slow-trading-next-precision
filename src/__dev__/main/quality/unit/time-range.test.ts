import { describe, expect, it } from "vitest";

import {
  localInputToMs,
  msToLocalInput,
} from "@/lib/system/utils/ui/time-range";

describe("time-range input helpers", () => {
  // BOTH: none — UI input formatting helper

  it("formats ms using local date components, not UTC", () => {
    // Regression: toISOString() previously shifted the displayed value by
    // the local timezone offset.
    const ms = new Date(2025, 0, 2, 17, 0).getTime();
    expect(msToLocalInput(ms)).toBe("2025-01-02T17:00");
  });

  it("round-trips a datetime-local value through both helpers", () => {
    expect(msToLocalInput(localInputToMs("2024-11-30T23:45"))).toBe(
      "2024-11-30T23:45",
    );
  });

  it("pads single-digit date and time parts", () => {
    const ms = new Date(2025, 2, 5, 6, 7).getTime();
    expect(msToLocalInput(ms)).toBe("2025-03-05T06:07");
  });

  it("returns an empty string for missing input", () => {
    expect(msToLocalInput(undefined)).toBe("");
    expect(msToLocalInput(0)).toBe("");
    expect(localInputToMs("")).toBeUndefined();
  });
});
