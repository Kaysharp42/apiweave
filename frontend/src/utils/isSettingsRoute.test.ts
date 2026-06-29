import { describe, expect, it } from "vitest";
import { isSettingsRoute } from "./isSettingsRoute";

describe("isSettingsRoute", () => {
  it("treats settings, audit, and organizations as settings routes", () => {
    expect(isSettingsRoute("/personal/personal/settings/environments")).toBe(
      true,
    );
    expect(isSettingsRoute("/audit")).toBe(true);
    // Regression: /organizations must count, else MainLayout flips the sidebar
    // back to workflows on landing.
    expect(isSettingsRoute("/organizations")).toBe(true);
  });

  it("does not match workflow/home routes", () => {
    expect(isSettingsRoute("/personal/personal/workflows")).toBe(false);
    expect(isSettingsRoute("/app")).toBe(false);
    expect(isSettingsRoute("/")).toBe(false);
  });
});
