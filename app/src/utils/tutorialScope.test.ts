import { describe, expect, it } from "vitest";
import { resolveTutorialScope } from "./tutorialScope";

describe("resolveTutorialScope", () => {
  it("resolves the org-less workspace route to the personal org", () => {
    expect(resolveTutorialScope("/personal/workflows")).toEqual({
      orgSlug: "personal",
      workspaceSlug: "personal",
    });
    expect(resolveTutorialScope("/personal/tutorials/first-workflow")).toEqual({
      orgSlug: "personal",
      workspaceSlug: "personal",
    });
    expect(resolveTutorialScope("/personal/settings/secrets")).toEqual({
      orgSlug: "personal",
      workspaceSlug: "personal",
    });
    expect(resolveTutorialScope("/personal/projects/p-1")).toEqual({
      orgSlug: "personal",
      workspaceSlug: "personal",
    });
  });

  it("keeps the org prefix when the second segment is a workspace", () => {
    expect(resolveTutorialScope("/acme/team/workflows")).toEqual({
      orgSlug: "acme",
      workspaceSlug: "team",
    });
    expect(resolveTutorialScope("/acme/team/tutorials/sse")).toEqual({
      orgSlug: "acme",
      workspaceSlug: "team",
    });
    expect(resolveTutorialScope("/acme/personal")).toEqual({
      orgSlug: "acme",
      workspaceSlug: "personal",
    });
  });

  it("ignores trailing and repeated slashes", () => {
    expect(resolveTutorialScope("/acme/team/workflows/")).toEqual({
      orgSlug: "acme",
      workspaceSlug: "team",
    });
    expect(resolveTutorialScope("//personal//workflows")).toEqual({
      orgSlug: "personal",
      workspaceSlug: "personal",
    });
  });

  it("falls back to the personal workspace for empty or global routes", () => {
    const fallback = { orgSlug: "personal", workspaceSlug: "personal" };
    expect(resolveTutorialScope("")).toEqual(fallback);
    expect(resolveTutorialScope("/")).toEqual(fallback);
    expect(resolveTutorialScope("/app")).toEqual(fallback);
    expect(resolveTutorialScope("/cloud/sync")).toEqual(fallback);
    expect(resolveTutorialScope("/setup")).toEqual(fallback);
  });
});
