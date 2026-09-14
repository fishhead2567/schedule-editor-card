import { describe, expect, it } from "vitest";
import { errorMessage, groupedBlocks } from "./schedule-api";
import { ScheduleRecord } from "./types";

function record(days: Partial<ScheduleRecord>): ScheduleRecord {
  return {
    id: "test",
    name: "Test",
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
    ...days,
  };
}

describe("errorMessage", () => {
  it("extracts message from a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts message from HA's {code, message} websocket rejection shape", () => {
    expect(errorMessage({ code: "invalid_format", message: "Overlapping times found" })).toBe(
      "Overlapping times found"
    );
  });

  it("extracts message from hass.callApi's {error, status_code, body} rejection shape", () => {
    expect(
      errorMessage({ error: "Response error: 404", status_code: 404, body: { message: "Resource not found" } })
    ).toBe("Resource not found");
  });

  it("falls back to String() for anything else", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("groupedBlocks", () => {
  it("groups an identical block across every day into one entry", () => {
    const block = { from: "18:00:00", to: "22:00:00" };
    const r = record({
      monday: [block], tuesday: [block], wednesday: [block], thursday: [block],
      friday: [block], saturday: [block], sunday: [block],
    });
    const groups = groupedBlocks(r);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      from: "18:00:00",
      to: "22:00:00",
      days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    });
  });

  it("keeps distinct time ranges as separate groups even on overlapping days", () => {
    const r = record({
      tuesday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
      thursday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
    });
    const groups = groupedBlocks(r);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ from: "00:15:00", to: "00:35:00", days: ["tuesday", "thursday"] });
    expect(groups[1]).toEqual({ from: "05:00:00", to: "05:20:00", days: ["tuesday", "thursday"] });
  });

  it("does not merge times that are only close, not identical", () => {
    const r = record({
      monday: [{ from: "08:00:00", to: "08:20:00" }],
      tuesday: [{ from: "08:00:00", to: "08:25:00" }],
    });
    const groups = groupedBlocks(r);
    expect(groups).toHaveLength(2);
  });

  it("returns an empty list for a schedule with no blocks", () => {
    expect(groupedBlocks(record({}))).toEqual([]);
  });
});
