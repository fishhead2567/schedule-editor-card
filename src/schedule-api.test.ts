import { describe, expect, it } from "vitest";
import { errorMessage } from "./schedule-api";

describe("errorMessage", () => {
  it("extracts message from a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts message from HA's {code, message} websocket rejection shape", () => {
    expect(errorMessage({ code: "invalid_format", message: "Overlapping times found" })).toBe(
      "Overlapping times found"
    );
  });

  it("falls back to String() for anything else", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
