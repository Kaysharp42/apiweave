import { describe, expect, it } from "vitest";
import type { GitErrorCode } from "@shared/types/GitErrorCode";
import { describeGitError, remoteHost } from "./gitErrorMessages";

const CODES: readonly GitErrorCode[] = [
  "git_not_installed",
  "identity_missing",
  "auth_failed",
  "account_unavailable",
  "non_fast_forward",
  "permission_denied",
  "network_error",
  "not_a_repository",
  "timeout",
  "invalid_argument",
  "command_failed",
];

describe("remoteHost", () => {
  it.each([
    ["https://github.com/acme/tests.git", "github.com"],
    ["ssh://git@gitlab.example.com:2222/acme/tests.git", "gitlab.example.com"],
    ["git@github.com:acme/tests.git", "github.com"],
    ["file:///srv/git/tests.git", null],
    ["not a url", null],
    [null, null],
  ])("%s → %s", (url, host) => {
    expect(remoteHost(url)).toBe(host);
  });
});

describe("describeGitError", () => {
  it.each(CODES)("says something specific about %s, never git's text", (code) => {
    const message = describeGitError({ code, message: "fatal: raw git output" }, "https://github.com/a/b.git");
    expect(message.length).toBeGreaterThan(20);
    expect(message).not.toContain("fatal");
    expect(message).not.toContain("undefined");
  });

  it("names the host, from either kind of URL, where the cause is the remote", () => {
    const url = "git@github.com:acme/tests.git";
    expect(describeGitError({ code: "auth_failed", message: "" }, url)).toBe(
      "Sign-in to github.com failed — your credential manager will ask again on retry.",
    );
    expect(describeGitError({ code: "network_error", message: "" }, "https://example.org/a.git")).toBe(
      "Can't reach example.org — check your connection. APIWeave retries every 5 minutes.",
    );
    expect(describeGitError({ code: "timeout", message: "" }, url)).toContain("github.com");
  });

  it("names the bound account, not the credential manager, when a bound workspace's sign-in is turned down", () => {
    const account = { provider: "github" as const, host: "github.com", login: "octo-personal" };
    const message = describeGitError({ code: "auth_failed", message: "" }, "https://github.com/acme/tests.git", account);
    expect(message).toBe(
      "github.com turned down octo-personal's sign-in — sign in to that account again, or choose another account in the workspace's version history settings.",
    );
    expect(message).not.toMatch(/credential manager/);
    // Other failures read the same either way.
    expect(describeGitError({ code: "timeout", message: "" }, "https://github.com/a.git", account)).toBe(
      describeGitError({ code: "timeout", message: "" }, "https://github.com/a.git"),
    );
  });

  it("falls back to 'the remote' when the URL names no host, or there is none", () => {
    expect(describeGitError({ code: "network_error", message: "" }, "file:///srv/git/tests.git")).toContain("Can't reach the remote");
    expect(describeGitError({ code: "auth_failed", message: "" }, null)).toContain("Sign-in to the remote failed");
  });

  it("gives the answers the plan asks for", () => {
    expect(describeGitError({ code: "git_not_installed", message: "" }, null)).toBe(
      "Git isn't installed — install Git and restart APIWeave.",
    );
    // A refused push is read-only, not an error; this one is a fetch or clone the host refused.
    expect(describeGitError({ code: "permission_denied", message: "" }, "https://github.com/a/b.git")).toBe(
      "github.com refused access to this repo — check the URL, and that you're signed in with an account that can read it.",
    );
    expect(describeGitError({ code: "permission_denied", message: "" }, null)).not.toMatch(/push/i);
    const damaged = describeGitError({ code: "not_a_repository", message: "" }, null);
    expect(damaged).toMatch(/If it is missing, restarting APIWeave recreates it/);
    expect(damaged).toMatch(/damaged.*track it again/);
    expect(describeGitError({ code: "identity_missing", message: "" }, null)).toMatch(/name and email/);
  });

  it("uses the message itself for a failure that is not git's", () => {
    expect(describeGitError({ code: null, message: "workflows/x--1.json: nodes: invalid" }, null)).toBe(
      "workflows/x--1.json: nodes: invalid",
    );
  });
});
