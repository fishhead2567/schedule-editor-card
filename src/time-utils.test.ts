import { describe, expect, it } from "vitest";
import {
  addDaysToWeekday,
  blocksOverlap,
  currentMinutesInZone,
  dateLabelForOffset,
  hasOverlap,
  minutesToHM,
  percentOfDay,
  todayWeekdayInZone,
  toMinutes,
} from "./time-utils";

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

describe("currentMinutesInZone", () => {
  // Etc/GMT+5 is a fixed UTC-5 offset with no DST, chosen specifically to
  // avoid any date-dependent ambiguity in this test.
  it("computes minutes in a fixed-offset zone, independent of the runner's own timezone", () => {
    const date = new Date("2026-01-15T05:30:00Z");
    expect(currentMinutesInZone("Etc/GMT+5", date)).toBe(30); // 05:30 UTC - 5h = 00:30
  });

  it("matches UTC directly when given the UTC zone", () => {
    const date = new Date("2026-01-15T05:30:00Z");
    expect(currentMinutesInZone("UTC", date)).toBe(5 * 60 + 30);
  });

  it("falls back to the runtime's own zone when none is given, without throwing", () => {
    expect(() => currentMinutesInZone(undefined, new Date())).not.toThrow();
  });
});

describe("todayWeekdayInZone", () => {
  it("matches the UTC day-of-week for a UTC instant", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    const expected = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
    expect(todayWeekdayInZone("UTC", date)).toBe(expected);
  });

  it("can disagree with the UTC day when the zone crosses a date boundary", () => {
    // 02:00 UTC on the 16th is still 21:00 on the 15th in Etc/GMT+5 (UTC-5).
    const date = new Date("2026-01-16T02:00:00Z");
    const utcWeekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
    const zoneWeekday = todayWeekdayInZone("Etc/GMT+5", date);
    expect(zoneWeekday).not.toBe(utcWeekday);
  });
});

describe("addDaysToWeekday", () => {
  it("cycles forward and wraps at the week boundary", () => {
    expect(addDaysToWeekday("monday", 1)).toBe("tuesday");
    expect(addDaysToWeekday("sunday", 1)).toBe("monday");
    expect(addDaysToWeekday("monday", 7)).toBe("monday");
  });

  it("cycles backward and wraps at the week boundary", () => {
    expect(addDaysToWeekday("monday", -1)).toBe("sunday");
    expect(addDaysToWeekday("monday", -7)).toBe("monday");
  });

  it("handles offset 0 as a no-op", () => {
    expect(addDaysToWeekday("thursday", 0)).toBe("thursday");
  });
});

describe("dateLabelForOffset", () => {
  it("formats the given day", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    expect(dateLabelForOffset("UTC", 0, date)).toBe("Jan 15");
  });

  it("handles month rollover", () => {
    const date = new Date("2026-01-31T12:00:00Z");
    expect(dateLabelForOffset("UTC", 1, date)).toBe("Feb 1");
  });

  it("handles negative offsets and year rollover", () => {
    const date = new Date("2026-01-01T12:00:00Z");
    expect(dateLabelForOffset("UTC", -1, date)).toBe("Dec 31");
  });
});
