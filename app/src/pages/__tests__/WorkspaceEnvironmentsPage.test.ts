import { describe, expect, it } from "vitest";
import { environmentWritePayload } from "../WorkspaceEnvironmentsPage";
import type { EnvironmentFormData } from "../../types";

const form: EnvironmentFormData = {
  name: "dev",
  description: "",
  swaggerDocUrl: "",
  baseEnvironmentId: null,
  variables: {},
};

describe("environmentWritePayload", () => {
  it("sends null for cleared optional text so the patch actually clears it", () => {
    // `undefined` would be dropped by JSON.stringify and the merge would keep
    // the stored value — the bug where clearing Swagger Doc URL did nothing.
    const payload = environmentWritePayload(form);
    expect(payload.swaggerDocUrl).toBeNull();
    expect(payload.description).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty(
      "swaggerDocUrl",
      null,
    );
  });

  it("treats whitespace-only input as cleared", () => {
    expect(
      environmentWritePayload({ ...form, swaggerDocUrl: "   " }).swaggerDocUrl,
    ).toBeNull();
  });

  it("passes a real url through untouched", () => {
    expect(
      environmentWritePayload({
        ...form,
        swaggerDocUrl: " https://api.example.com/openapi.json ",
      }).swaggerDocUrl,
    ).toBe("https://api.example.com/openapi.json");
  });
});
