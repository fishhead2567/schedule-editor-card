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
