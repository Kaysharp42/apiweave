import { describe, expect, it } from "vitest";
import { isSettingsRoute } from "./isSettingsRoute";

describe("isSettingsRoute", () => {
  it("treats settings pages as settings routes", () => {
    expect(isSettingsRoute("/personal/personal/settings/environments")).toBe(
      true,
    );
  });

  it("does not match workflow/home routes", () => {
    expect(isSettingsRoute("/personal/personal/workflows")).toBe(false);
    expect(isSettingsRoute("/app")).toBe(false);
    expect(isSettingsRoute("/")).toBe(false);
  });
});
