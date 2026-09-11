import { describe, expect, it } from "vitest";
import { blocksOverlap, hasOverlap, minutesToHM, percentOfDay, toMinutes } from "./time-utils";

describe("toMinutes", () => {
  it("parses HH:MM:SS", () => {
    expect(toMinutes("00:15:00")).toBe(15);
    expect(toMinutes("05:20:00")).toBe(320);
    expect(toMinutes("23:59:00")).toBe(1439);
  });

  it("parses HH:MM", () => {
    expect(toMinutes("12:00")).toBe(720);
  });
});

describe("minutesToHM", () => {
  it("formats and wraps at 24h", () => {
    expect(minutesToHM(0)).toBe("00:00");
    expect(minutesToHM(75)).toBe("01:15");
    expect(minutesToHM(1440)).toBe("00:00");
  });
});

describe("percentOfDay", () => {
  it("computes position for CSS", () => {
    expect(percentOfDay("00:00:00")).toBe(0);
    expect(percentOfDay("12:00:00")).toBeCloseTo(50);
    expect(percentOfDay("06:00:00")).toBeCloseTo(25);
  });
});

describe("blocksOverlap / hasOverlap", () => {
  it("detects overlapping blocks", () => {
    expect(blocksOverlap({ from: "00:15:00", to: "00:35:00" }, { from: "00:20:00", to: "00:40:00" })).toBe(true);
  });

  it("detects adjacent non-overlapping blocks as fine", () => {
    expect(blocksOverlap({ from: "00:15:00", to: "00:35:00" }, { from: "00:35:00", to: "00:40:00" })).toBe(false);
  });

  it("finds no overlap in a normal day", () => {
    expect(
      hasOverlap([
        { from: "00:15:00", to: "00:35:00" },
        { from: "05:00:00", to: "05:20:00" },
      ])
    ).toBe(false);
  });

  it("finds an overlap when blocks collide", () => {
    expect(
      hasOverlap([
        { from: "00:15:00", to: "00:35:00" },
        { from: "00:30:00", to: "00:45:00" },
      ])
    ).toBe(true);
  });
});
