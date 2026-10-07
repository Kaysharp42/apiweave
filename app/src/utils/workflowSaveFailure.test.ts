import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeThrownSaveError, readSaveFailure } from "./workflowSaveFailure";
import { IpcError } from "./apiweaveClient";

describe("readSaveFailure", () => {
  it("reads the message and code of a rejected save", () => {
    const envelope = readSaveFailure(
      new IpcError("not_found", "environment not found"),
    );
    expect(envelope).toEqual({
      detail: "environment not found",
      code: "not_found",
      issues: [],
    });
  });

  it("flattens zod issues into path: message lines", () => {
    const envelope = readSaveFailure(
      new IpcError("validation", "request validation failed", [
        { path: ["nodes", 2, "config", "url"], message: "Invalid url" },
        { message: "a global failure" },
        "not an issue",
      ]),
    );
    expect(envelope.issues).toEqual([
      "nodes.2.config.url: Invalid url",
      "a global failure",
    ]);
  });

  it("ignores details that are not an issue list", () => {
    const envelope = readSaveFailure(
      new IpcError("validation", "", { paths: ["x"] }),
    );
    expect(envelope).toEqual({ code: "validation", issues: [] });
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
