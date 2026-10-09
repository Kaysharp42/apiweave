import { describe, expect, it } from "vitest";
import { envImportStatus, planEnvImport } from "./environmentImport";

const variables = { BASE_URL: "https://old.test", USER: "bob" };
const secrets = new Set(["API_KEY"]);

describe("envImportStatus", () => {
  it("compares plain values and reports stored secrets as existing", () => {
    expect(envImportStatus({ key: "BASE_URL", value: "https://new.test", asSecret: false }, variables, secrets)).toBe("changed");
    expect(envImportStatus({ key: "USER", value: "bob", asSecret: false }, variables, secrets)).toBe("unchanged");
    expect(envImportStatus({ key: "PORT", value: "8080", asSecret: false }, variables, secrets)).toBe("new");
    expect(envImportStatus({ key: "API_KEY", value: "k", asSecret: true }, variables, secrets)).toBe("exists");
    expect(envImportStatus({ key: "TOKEN", value: "t", asSecret: true }, variables, secrets)).toBe("new");
  });
});

describe("planEnvImport", () => {
  const rows = [
    { key: "BASE_URL", value: "https://new.test", asSecret: false },
    { key: "USER", value: "bob", asSecret: false },
    { key: "PORT", value: "8080", asSecret: false },
    { key: "API_KEY", value: "k-new", asSecret: true },
    { key: "TOKEN", value: "t-secret", asSecret: true },
  ];

  it("keeps existing values on conflict", () => {
    const plan = planEnvImport(rows, variables, secrets, false);
    expect(plan.variables).toEqual({ BASE_URL: "https://old.test", USER: "bob", PORT: "8080" });
    expect(plan.secrets).toEqual([{ name: "TOKEN", value: "t-secret" }]);
    expect(plan.kept).toBe(2);
  });

  it("overwrites conflicts when asked", () => {
    const plan = planEnvImport(rows, variables, secrets, true);
    expect(plan.variables).toEqual({ BASE_URL: "https://new.test", USER: "bob", PORT: "8080" });
    expect(plan.secrets).toEqual([
      { name: "API_KEY", value: "k-new" },
      { name: "TOKEN", value: "t-secret" },
    ]);
    expect(plan.kept).toBe(0);
  });

  it("never writes a secret's value as a plain variable", () => {
    const plan = planEnvImport(rows, variables, secrets, true);
    const plainValues = Object.values(plan.variables);
    expect(plainValues).not.toContain("k-new");
    expect(plainValues).not.toContain("t-secret");
    expect(Object.keys(plan.variables)).not.toContain("TOKEN");
  });

  it("keeps a __proto__ key an ordinary variable", () => {
    const plan = planEnvImport([{ key: "__proto__", value: "x", asSecret: false }], {}, new Set(), true);
    expect(Object.getPrototypeOf(plan.variables)).toBe(Object.prototype);
    expect(Object.keys(plan.variables)).toEqual(["__proto__"]);
  });
});
