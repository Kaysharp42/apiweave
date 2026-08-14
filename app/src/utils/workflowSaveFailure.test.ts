import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  describeThrownSaveError,
  readSaveFailureEnvelope,
} from "./workflowSaveFailure";

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("readSaveFailureEnvelope", () => {
  it("reads detail and code from a rejected save response", async () => {
    const envelope = await readSaveFailureEnvelope(
      jsonResponse({ detail: "environment not found", code: "not_found" }, 404),
    );
    expect(envelope).toEqual({
      detail: "environment not found",
      code: "not_found",
      issues: [],
    });
  });

  it("flattens zod issues into path: message lines", async () => {
    const envelope = await readSaveFailureEnvelope(
      jsonResponse({
        detail: "request validation failed",
        code: "validation",
        details: [
          { path: ["nodes", 2, "config", "url"], message: "Invalid url" },
          { message: "a global failure" },
          "not an issue",
        ],
      }),
    );
    expect(envelope.issues).toEqual([
      "nodes.2.config.url: Invalid url",
      "a global failure",
    ]);
  });

  it("returns an empty envelope when the body is not json", async () => {
    const envelope = await readSaveFailureEnvelope(
      new Response("gateway exploded", { status: 500 }),
    );
    expect(envelope).toEqual({ issues: [] });
  });

  it("ignores malformed detail, code and details fields", async () => {
    const envelope = await readSaveFailureEnvelope(
      jsonResponse({ detail: 42, code: { nested: true }, details: "nope" }),
    );
    expect(envelope).toEqual({ issues: [] });
  });
});

describe("describeThrownSaveError", () => {
  it("names the exact field a zod failure rejected", () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 42 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const message = describeThrownSaveError(parsed.error);
    expect(message).toMatch(/^workflow data failed validation — name: /);
  });

  it("falls back to a plain error message", () => {
    expect(describeThrownSaveError(new Error("sync push failed"))).toBe(
      "sync push failed",
    );
  });

  it("returns undefined for anything without a message", () => {
    expect(describeThrownSaveError("a string")).toBeUndefined();
    expect(describeThrownSaveError(null)).toBeUndefined();
  });
});
