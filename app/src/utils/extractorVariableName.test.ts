import { describe, expect, test } from "vitest";
import {
  isValidVariableName,
  suggestVariableName,
} from "./extractorVariableName";

describe("isValidVariableName", () => {
  test("accepts what the {{variables.x}} syntax can reference", () => {
    expect(isValidVariableName("token")).toBe(true);
    expect(isValidVariableName("_dogId2")).toBe(true);
  });

  test("rejects names the substitution regex would not match", () => {
    expect(isValidVariableName("")).toBe(false);
    expect(isValidVariableName("2fa")).toBe(false);
    expect(isValidVariableName("dog-id")).toBe(false);
    expect(isValidVariableName("{{token}}")).toBe(false);
  });
});

describe("suggestVariableName", () => {
  test("uses the leaf key when it is free", () => {
    expect(suggestVariableName(["id"], [])).toBe("id");
    expect(suggestVariableName(["data", "user", "id"], [])).toBe("id");
  });

  test("folds in the parent key once the leaf name is taken", () => {
    expect(suggestVariableName(["data", "user", "id"], ["id"])).toBe("userId");
    expect(suggestVariableName(["data", "user", "id"], ["id", "userId"])).toBe(
      "dataUserId",
    );
  });

  test("numbers the deepest candidate when every name is taken", () => {
    expect(
      suggestVariableName(["data", "user", "id"], ["id", "userId", "dataUserId"]),
    ).toBe("dataUserId2");
  });

  test("drops array indices and normalises separators", () => {
    expect(suggestVariableName(["items", 0, "user-name"], [])).toBe("userName");
  });

  test("falls back to the body itself when there is no usable key", () => {
    expect(suggestVariableName([], [])).toBe("body");
    expect(suggestVariableName([0], ["body"])).toBe("body2");
  });

  test("always returns a referenceable name", () => {
    expect(isValidVariableName(suggestVariableName([0], []))).toBe(true);
    expect(isValidVariableName(suggestVariableName(["2fa"], []))).toBe(true);
  });
});
