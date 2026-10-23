import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  lastLine,
  parseCliVersion,
  parseGhAccounts,
  parseGhToken,
  parseGlabAccounts,
  parseGlabCredential,
  parseSignedInLogin,
  parseSignInPrompt,
} from "../host_cli_parse"

/** Recorded from gh 2.97.0 with two github.com accounts signed in; the two logins are renamed, nothing else is changed. */
const GH_RECORDED = fs.readFileSync(path.join(__dirname, "fixtures", "gh-auth-status.json"), "utf8")

/**
 * Not recorded — derived from source, because glab is not installed where
 * this was written. A recorded fixture from a real `glab auth status --all
 * --output json` is still to come. This is the shape glab's `hostStatus`
 * struct marshals to in gitlab-org/cli `internal/commands/auth/status/status.go`
 * as of b479524a (2026-10-08, "feat(auth): add JSON output to auth status" —
 * glab before it has no `--output json` here): `user`, `error` and
 * `git_protocol` are `omitempty`, and `token` is never in the JSON.
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
        "ghe.example.com": [{ state: "error", error: "HTTP 401", active: true, host: "ghe.example.com", login: "", tokenSource: "/home/u/.config/gh/hosts.yml", gitProtocol: "https" }],
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

  it("does not offer a token gh reads from the environment, and lists its stored owner once", () => {
    // With GH_TOKEN set, gh lists the token's owner as active (looked up over
    // the API), then every stored account — the same login among them.
    const output = JSON.stringify({
      hosts: {
        "github.com": [
          { state: "success", active: true, host: "github.com", login: "octo-work", tokenSource: "GH_TOKEN", gitProtocol: "https" },
          { state: "success", active: false, host: "github.com", login: "octo-work", tokenSource: "keyring", gitProtocol: "https" },
          { state: "success", active: false, host: "github.com", login: "octo-personal", tokenSource: "keyring", gitProtocol: "https" },
        ],
        "ghe.example.com": [
          { state: "success", active: true, host: "ghe.example.com", login: "ops", tokenSource: "GH_ENTERPRISE_TOKEN", gitProtocol: "https" },
        ],
      },
    })

    const parsed = parseGhAccounts(output)

    expect(parsed?.accounts.map((account) => `${account.host}:${account.login}:${account.active}`)).toEqual([
      "github.com:octo-work:false",
      "github.com:octo-personal:false",
    ])
    expect(parsed?.problems).toEqual([
      "github.com: gh is using the token in GH_TOKEN, which is not an account APIWeave can choose; only the accounts gh stores are listed",
      "ghe.example.com: gh is using the token in GH_ENTERPRISE_TOKEN, which is not an account APIWeave can choose; only the accounts gh stores are listed",
    ])
  })

  it("lists an account gh repeats only once", () => {
    const entry = { state: "success", active: false, host: "github.com", login: "octo", tokenSource: "keyring", gitProtocol: "https" }
    expect(parseGhAccounts(JSON.stringify({ hosts: { "github.com": [entry, entry] } }))?.accounts).toHaveLength(1)
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

/**
 * Not recorded — no real sign-in was run. gh 2.97's lines with no terminal are
 * `internal/authflow/flow.go`'s `DisplayCode` and non-interactive `BrowseURL`;
 * the last are `pkg/cmd/auth/shared/login_flow.go`'s. glab's are
 * `internal/oauth2/device.go`'s and `internal/commands/auth/login/login.go`'s.
 */
const GH_SIGN_IN = [
  "",
  "! First copy your one-time code: 3F2A-9C1B",
  "Open this URL to continue in your web browser: https://github.com/login/device",
  "✓ Authentication complete.",
  "✓ Logged in as octo-personal",
  "",
].join("\n")

const GLAB_SIGN_IN = [
  "- Signing into gitlab.com",
  "",
  "First copy your one-time code: WXYZ-ABCD",
  "Then open this URL on any device to authorize: https://gitlab.com/oauth/device",
  "",
  "Waiting for authorization...",
  "✓ Logged in as tanuki",
  "✓ Stored your credentials in the operating system keyring.",
].join("\n")

describe("parseSignInPrompt", () => {
  it("reads gh's code and page", () => {
    expect(parseSignInPrompt(GH_SIGN_IN, "github.com")).toEqual({ code: "3F2A-9C1B", url: "https://github.com/login/device" })
  })

  it("reads glab's device-flow code and page", () => {
    expect(parseSignInPrompt(GLAB_SIGN_IN, "gitlab.com")).toEqual({ code: "WXYZ-ABCD", url: "https://gitlab.com/oauth/device" })
  })

  it("reads through colour codes, and a self-hosted host with a port", () => {
    const coloured = "\x1b[0;33m!\x1b[0m First copy your one-time code: \x1b[0;1mAB12-CD34\x1b[0m\n\x1b[1mOpen this URL\x1b[0m to continue in your web browser: https://ghe.example.com/login/device\n"
    expect(parseSignInPrompt(coloured, "ghe.example.com:8443")).toEqual({ code: "AB12-CD34", url: "https://ghe.example.com/login/device" })
  })

  it("waits until the page's line has ended", () => {
    expect(parseSignInPrompt("! First copy your one-time code: 3F2A-9C1B\n", "github.com")).toBeUndefined()
    expect(parseSignInPrompt("! First copy your one-time code: 3F2A-9C1B\nOpen this URL: https://github.com/lo", "github.com")).toBeUndefined()
  })

  it("reads the code from gh's clipboard line too (gh 2.103's `clipboard` setting)", () => {
    // gh v2.103.0 internal/authflow/flow.go, when the copy succeeds.
    const clipboard = "! One-time code (3F2A-9C1B) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device\n"
    expect(parseSignInPrompt(clipboard, "github.com")).toEqual({ code: "3F2A-9C1B", url: "https://github.com/login/device" })
  })

  it("reads a page with no code: a GitHub Enterprise Server with no device flow, whose browser redirect finishes the sign-in", () => {
    // cli/oauth v1.2.2 falls back to WebAppFlow, which only calls BrowseURL.
    const webFlow = "\nOpen this URL to continue in your web browser: https://ghe.example.com/login/oauth/authorize?client_id=178c6fc778ccc68e1d6a&redirect_uri=http%3A%2F%2Flocalhost%2F&scope=repo&state=abc\n"
    expect(parseSignInPrompt(webFlow, "ghe.example.com")).toEqual({
      code: null,
      url: "https://ghe.example.com/login/oauth/authorize?client_id=178c6fc778ccc68e1d6a&redirect_uri=http%3A%2F%2Flocalhost%2F&scope=repo&state=abc",
    })
  })

  it("refuses a page anywhere but exactly the host, or over plain http: main would open it", () => {
    expect(parseSignInPrompt("one-time code: 3F2A-9C1B\nOpen https://evil.example/login/device\n", "github.com")).toBeUndefined()
    expect(parseSignInPrompt("one-time code: 3F2A-9C1B\nOpen https://github.com.evil.example/x\n", "github.com")).toBeUndefined()
    expect(parseSignInPrompt("one-time code: 3F2A-9C1B\nOpen https://gist.github.com/login/device\n", "github.com")).toBeUndefined()
    expect(parseSignInPrompt("one-time code: 3F2A-9C1B\nOpen http://github.com/login/device\n", "github.com")).toBeUndefined()
  })
})

describe("parseSignedInLogin and lastLine", () => {
  it("read who signed in, and why a sign-in failed", () => {
    expect(parseSignedInLogin(GH_SIGN_IN)).toBe("octo-personal")
    expect(parseSignedInLogin(GLAB_SIGN_IN)).toBe("tanuki")
    expect(parseSignedInLogin("! First copy your one-time code: 3F2A-9C1B\n")).toBeUndefined()
    expect(lastLine("! First copy your one-time code: 3F2A-9C1B\nfailed to authenticate via web browser: access_denied\n\n")).toBe(
      "failed to authenticate via web browser: access_denied",
    )
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
