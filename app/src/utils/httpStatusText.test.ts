import { describe, it, expect } from "vitest";
import { httpStatusText } from "./httpStatusText";

describe("httpStatusText", () => {
  it("returns the reason phrase for common codes", () => {
    expect(httpStatusText(200)).toBe("OK");
    expect(httpStatusText(201)).toBe("Created");
    expect(httpStatusText(404)).toBe("Not Found");
    expect(httpStatusText(502)).toBe("Bad Gateway");
  });

  it("falls back to the status class for uncommon codes", () => {
    expect(httpStatusText(418)).toBe("Client Error");
    expect(httpStatusText(599)).toBe("Server Error");
    expect(httpStatusText(299)).toBe("Success");
    expect(httpStatusText(399)).toBe("Redirect");
    expect(httpStatusText(100)).toBe("Informational");
  });

  it("returns null for absent or out-of-range codes", () => {
    expect(httpStatusText(null)).toBeNull();
    expect(httpStatusText(undefined)).toBeNull();
    expect(httpStatusText(99)).toBeNull();
    expect(httpStatusText(600)).toBeNull();
    expect(httpStatusText(Number.NaN)).toBeNull();
  });
});
