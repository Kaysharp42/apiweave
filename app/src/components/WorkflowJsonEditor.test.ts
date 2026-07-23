import { describe, expect, it } from "vitest";
import { sanitizeWorkflowJsonForPrompt } from "./WorkflowJsonEditor";

describe("sanitizeWorkflowJsonForPrompt — AI prompt export redaction", () => {
  it("redacts auth.bearer.token, auth.basic.password, auth.apiKey.value structurally", () => {
    const node = {
      config: {
        auth: {
          type: "apiKey",
          bearer: { token: "raw-bearer-token" },
          basic: { username: "alice", password: "hunter2" },
          apiKey: { key: "X-API-Key", value: "raw-secret-value", addTo: "header" },
        },
      },
    };
    const sanitized = sanitizeWorkflowJsonForPrompt(node) as typeof node;
    expect(sanitized.config.auth.bearer.token).toBe("<REDACTED>");
    expect(sanitized.config.auth.basic.password).toBe("<REDACTED>");
    expect(sanitized.config.auth.basic.username).toBe("alice");
    expect(sanitized.config.auth.apiKey.value).toBe("<REDACTED>");
    expect(sanitized.config.auth.apiKey.key).toBe("X-API-Key");
  });

  it("redacts secret-shaped header/cookie values but keeps other key-value pairs", () => {
    const node = {
      config: {
        headers: [
          { key: "Authorization", value: "Bearer super-secret" },
          { key: "Accept", value: "application/json" },
        ],
      },
    };
    const sanitized = sanitizeWorkflowJsonForPrompt(node) as typeof node;
    expect(sanitized.config.headers[0]).toEqual({ key: "Authorization", value: "<REDACTED>" });
    expect(sanitized.config.headers[1]).toEqual({ key: "Accept", value: "application/json" });
  });

  it("redacts top-level secret-shaped variable keys", () => {
    const workflow = { variables: { apiToken: "raw-token-value", label: "keep me" } };
    const sanitized = sanitizeWorkflowJsonForPrompt(workflow) as typeof workflow;
    expect(sanitized.variables.apiToken).toBe("<REDACTED>");
    expect(sanitized.variables.label).toBe("keep me");
  });
});
