import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  parseCliVersion,
  parseGhAccounts,
  parseGhToken,
  parseGlabAccounts,
  parseGlabCredential,
} from "../host_cli_parse"

/** Recorded from gh 2.97.0 with two github.com accounts signed in; the two logins are renamed, nothing else is changed. */
const GH_RECORDED = fs.readFileSync(path.join(__dirname, "fixtures", "gh-auth-status.json"), "utf8")

/**
 * glab is not recorded: this is the shape its `hostStatus` struct marshals to
 * (gitlab-org/cli `internal/commands/auth/status/status.go`): `user`, `error`
 * and `git_protocol` are `omitempty`, `token` is never in the JSON.
 */
const GLAB_FROM_SOURCE = JSON.stringify({
  hosts: [
    {
      host: "gitlab.com",
      state: "success",
      user: "tanuki",
      token_source: "keyring",
      git_protocol: "https",
      api_protocol: "https",
      api_endpoint: "https://gitlab.com/api/v4/",
      graphql_endpoint: "https://gitlab.com/api/graphql/",
    },
    {
      host: "gitlab.example.com",
      state: "success",
      user: "ops",
      token_source: "config_file",
      api_endpoint: "https://gitlab.example.com/api/v4/",
      graphql_endpoint: "https://gitlab.example.com/api/graphql/",
    },
    {
      host: "git.internal.example",
      state: "error",
      error: "GET https://git.internal.example/api/v4/user: 401 {message: 401 Unauthorized}",
      token_source: "keyring",
      api_endpoint: "https://git.internal.example/api/v4/",
      graphql_endpoint: "https://git.internal.example/api/graphql/",
    },
  ],
})

describe("parseGhAccounts", () => {
  it("reads every account on every host from gh's recorded output", () => {
    expect(parseGhAccounts(GH_RECORDED)).toEqual({
      accounts: [
        { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null },
        { provider: "github", host: "github.com", login: "octo-personal", gitProtocol: "https", active: false, problem: null },
      ],
      problems: [],
    })
  })

  it("keeps an account whose token failed, with gh's reason, and names the host of a token it cannot attribute", () => {
    const output = JSON.stringify({
      hosts: {
        "github.com": [
          { state: "error", error: "HTTP 401: Bad credentials (https://api.github.com/)", active: true, host: "github.com", login: "octo-work", tokenSource: "keyring", gitProtocol: "ssh" },
          { state: "timeout", active: false, host: "github.com", login: "octo-personal", tokenSource: "keyring", gitProtocol: "https" },
        ],
        "ghe.example.com": [{ state: "error", error: "HTTP 401", active: true, host: "ghe.example.com", login: "", tokenSource: "GH_ENTERPRISE_TOKEN", gitProtocol: "https" }],
      },
    })

    expect(parseGhAccounts(output)).toEqual({
      accounts: [
        { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "ssh", active: true, problem: "HTTP 401: Bad credentials (https://api.github.com/)" },
        { provider: "github", host: "github.com", login: "octo-personal", gitProtocol: "https", active: false, problem: "gh reports this account's sign-in as timeout" },
      ],
      problems: ["ghe.example.com: HTTP 401"],
    })
  })

  it("reads no account when gh is signed in nowhere", () => {
    expect(parseGhAccounts('{"hosts":{}}\n')).toEqual({ accounts: [], problems: [] })
  })

  it.each(["", "You are not logged into any GitHub hosts.", '{"hosts":[]}', "{}"])("refuses output that is not gh's JSON: %j", (output) => {
    expect(parseGhAccounts(output)).toBeUndefined()
  })
})

describe("parseGlabAccounts", () => {
  it("reads one account per host, glab's ssh default included, and reports a host whose token failed", () => {
    expect(parseGlabAccounts(GLAB_FROM_SOURCE)).toEqual({
      accounts: [
        { provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: null },
        { provider: "gitlab", host: "gitlab.example.com", login: "ops", gitProtocol: "ssh", active: true, problem: null },
      ],
      problems: ["git.internal.example: GET https://git.internal.example/api/v4/user: 401 {message: 401 Unauthorized}"],
    })
  })

  it("reads Go's nil slice as no hosts", () => {
    expect(parseGlabAccounts('{"hosts":null}')).toEqual({ accounts: [], problems: [] })
  })

  it.each(["", "no GitLab instances have been authenticated with glab", '{"hosts":{}}'])("refuses output that is not glab's JSON: %j", (output) => {
    expect(parseGlabAccounts(output)).toBeUndefined()
  })
})

describe("parseGhToken", () => {
  it("reads the token alone on its line", () => {
    expect(parseGhToken("gho_0123456789abcdefABCDEF\n")).toBe("gho_0123456789abcdefABCDEF")
  })

  it.each(["", "\n", "two words", "gho_abc\ngho_def"])("refuses anything else: %j", (output) => {
    expect(parseGhToken(output)).toBeUndefined()
  })
})

describe("parseGlabCredential", () => {
  it("reads the user name and token from glab's git-credential answer, whatever order its map prints in", () => {
    // gitlab-org/cli `internal/commands/auth/login/helper.go`: a capability line, then the map's entries.
    const output = "capability[]=authtype\npassword_expiry_utc=1761150000\npassword=glpat-REDACTED_example=\nusername=oauth2\noauth_refresh_token=REDACTED\n"

    expect(parseGlabCredential(output)).toEqual({ username: "oauth2", password: "glpat-REDACTED_example=" })
  })

  it.each([
    ["no token", "capability[]=authtype\nusername=oauth2\n"],
    ["no user name", "password=glpat-x\n"],
    ["a token with a space in it", "username=oauth2\npassword=glpat x\n"],
    ["nothing", ""],
  ])("refuses an answer with %s", (_what, output) => {
    expect(parseGlabCredential(output)).toBeUndefined()
  })
})

describe("parseCliVersion", () => {
  it.each([
    ["gh version 2.97.0 (2026-07-31)\nhttps://github.com/cli/cli/releases/tag/v2.97.0\n", "2.97.0"],
    ["glab 1.46.1 (1a2b3c4)\n", "1.46.1"],
    ["glab version 1.36.0 (2024-01-10)\n", "1.36.0"],
  ])("reads %j as %s", (output, version) => {
    expect(parseCliVersion(output)).toBe(version)
  })

  it("reads nothing from output with no version", () => {
    expect(parseCliVersion("usage: gh")).toBeUndefined()
  })
})
