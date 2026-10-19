import { describe, expect, it } from "vitest"
import { assertWorkspaceRemoteUrl } from "../git_arguments"
import { GitInvalidArgumentError } from "../git_errors"

function refusalOf(url: string): unknown {
  try {
    assertWorkspaceRemoteUrl(url)
  } catch (error) {
    return error
  }
  throw new Error(`${url} was accepted`)
}

describe("assertWorkspaceRemoteUrl", () => {
  it.each([
    "https://github.com/acme/tests.git",
    "HTTPS://github.com/acme/tests.git",
    "https://git.example.com:8443/acme/tests.git",
    "ssh://git@github.com/acme/tests.git",
    "ssh://git@host/r",
    "ssh://git@host:2222/srv/tests.git",
    "file:///srv/git/tests.git",
    "file:///C:/Users/me/tests.git",
    "git@github.com:acme/tests.git",
    "git@host:o/r.git",
    "deploy_user@git.internal.example:team/tests",
  ])("accepts %s", (url) => {
    expect(assertWorkspaceRemoteUrl(url)).toBe(url)
  })

  it("returns the URL trimmed", () => {
    expect(assertWorkspaceRemoteUrl("  \thttps://github.com/acme/tests.git \n")).toBe("https://github.com/acme/tests.git")
  })

  it.each([
    ["an option", "-oProxyCommand=touch pwned"],
    ["an option behind whitespace", "  --upload-pack=touch pwned"],
    ["an upload-pack option", "--upload-pack=touch pwned"],
    ["the ext transport", "ext::sh -c touch% pwned"],
    ["the ext transport in capitals", "EXT::sh -c id"],
    ["plain http", "http://example.com/acme/tests.git"],
    ["the git protocol", "git://example.com/acme/tests.git"],
    ["a Windows drive path", "C:\\repo"],
    ["a Windows drive path with a slash", "C:/repo"],
    ["a UNC path", "\\\\server\\share\\repo.git"],
    ["a relative path", "repo.git"],
    ["an absolute path", "/srv/git/repo.git"],
    ["an scp-like URL with no path", "git@host:"],
    ["an scp-like URL with no user", "host:acme/tests.git"],
    ["an scp-like host that starts with a dash", "git@-oProxyCommand=calc:x"],
    ["an scp-like host that is only a dash", "git@-host:x"],
    ["a user name on a file URL, which the URL parser rejects", "file://user@host/srv/r.git"],
    ["a URL the parser cannot read", "https://exa[mple.com/r.git"],
    ["a scheme with nothing after it", "https://"],
    ["a scheme with only a space after it", "ssh:// "],
    ["whitespace inside the URL", "https://example.com/a b.git"],
    ["an embedded line break", "https://example.com/a.git\nhttps://evil.example/b.git"],
    ["an embedded null", "https://example.com/a\u0000.git"],
    ["nothing", ""],
    ["only whitespace", "   "],
  ])("refuses %s", (_label, url) => {
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow(GitInvalidArgumentError)
  })

  it.each([
    ["a user name on https", "https://token@github.com/o/r.git"],
    ["a user name and password on https", "https://x:y@host/r"],
    ["a user name and password on https, as a token", "https://octocat:ghp_hunter2@github.com/o/r.git"],
    ["a password on ssh", "ssh://git:secret@host/r"],
    ["an empty user name with a password", "https://:secret@host/r"],
    ["a percent-encoded user name", "https://%74oken@host/r"],
  ])("refuses %s, naming why", (_label, url) => {
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow(GitInvalidArgumentError)
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow(
      "A remote URL must not carry a user name or password: it is stored in plain text. Use an SSH URL, or let git's credential helper authenticate.",
    )
  })

  it("never echoes a credential back in the refusal", () => {
    const refusal = refusalOf("https://octocat:ghp_hunter2@github.com/o/r.git")
    expect(refusal).toBeInstanceOf(GitInvalidArgumentError)
    expect((refusal as Error).message).not.toContain("hunter2")
  })

  it.each([
    ["a host that starts with a dash", "ssh://-oProxyCommand=calc/x"],
    ["a user name that starts with a dash", "ssh://-oProxyCommand=calc@host/x"],
    ["an ssh host that starts with a dash, after a user", "ssh://git@-oProxyCommand=calc/x"],
    ["an https host that starts with a dash", "https://-evil/x"],
  ])("refuses %s, naming why", (_label, url) => {
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow(GitInvalidArgumentError)
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow(/must not start with '-'|must be https/)
  })

  it.each([
    ["a query string", "https://example.com/o/r.git?token=abc"],
    ["a fragment", "https://example.com/o/r.git#frag"],
    ["a backslash", "https://example.com\\evil.test/r.git"],
    ["a backslash in a file URL", "file:///C:\\repo.git"],
  ])("refuses %s in a scheme URL", (_label, url) => {
    expect(() => assertWorkspaceRemoteUrl(url)).toThrow("A remote URL must not contain '\\', '?' or '#'.")
  })

  it("names what is accepted, and says plain http is not", () => {
    expect(() => assertWorkspaceRemoteUrl("http://example.com/r.git")).toThrow(
      "A remote URL must be https://…, ssh://…, file://… or scp-like user@host:path. Plain http:// is not accepted.",
    )
  })
})
