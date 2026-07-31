import { describe, expect, it } from "vitest";
import {
  getValidBaseEnvironmentOptions,
  resolveInheritedVariables,
} from "./environmentInheritance";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";

function env(overrides: Partial<ScopedEnvironment> & { environmentId: string }): ScopedEnvironment {
  return {
    name: overrides.environmentId,
    variables: {},
    scopeType: "workspace",
    scopeId: "ws-1",
    isDefault: false,
    allowedWorkspaceIds: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("getValidBaseEnvironmentOptions", () => {
  it("excludes self and anything whose chain already loops back to it", () => {
    const a = env({ environmentId: "a" });
    const b = env({ environmentId: "b", baseEnvironmentId: "a" });
    const c = env({ environmentId: "c" });
    const environments = [a, b, c];

    const options = getValidBaseEnvironmentOptions("a", environments);

    expect(options.map((o) => o.environmentId)).toEqual(["c"]);
  });

  it("allows all environments when creating (no environmentId yet)", () => {
    const environments = [env({ environmentId: "a" }), env({ environmentId: "b" })];
    expect(getValidBaseEnvironmentOptions(undefined, environments).map((o) => o.environmentId)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("resolveInheritedVariables", () => {
  it("returns the base chain root-first with each level's own variables", () => {
    const base = env({ environmentId: "base", variables: { region: "eu" } });
    const mid = env({ environmentId: "mid", baseEnvironmentId: "base", variables: { host: "mid" } });
    const environments = [base, mid];

    const groups = resolveInheritedVariables("mid", environments);

    expect(groups.map((g) => g.source.environmentId)).toEqual(["base", "mid"]);
    expect(groups[0]?.variables).toEqual({ region: "eu" });
    expect(groups[1]?.variables).toEqual({ host: "mid" });
  });

  it("returns an empty list when there is no base environment", () => {
    expect(resolveInheritedVariables(null, [env({ environmentId: "a" })])).toEqual([]);
  });
});
