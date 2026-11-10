# Security Policy

## Supported Versions

APIWeave 1.x ships from a single release line. Only the latest release gets
security fixes; the in-app updater moves installs to it.

| Version | Supported |
| ------- | --------- |
| 1.x (latest release) | Yes |
| 0.x and anything older | No — update first |

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/Kaysharp42/apiweave/security/advisories/new>. Do not open a
public issue, pull request or discussion for a security problem.

Include the APIWeave version, your OS, the steps to reproduce, and what an
attacker gains. The [log file](docs/getting-started/installation.md#where-things-live)
often helps, but check it for anything sensitive before attaching it.

You will get an acknowledgement on the advisory. Once a fix ships, the advisory
is published with credit to you unless you ask otherwise.

## Scope

In scope:

- The desktop app, including how secrets are stored, resolved, masked and
  exported.
- The local MCP bridge: its token, origin and host checks, its tool whitelist,
  and what tool results disclose.
- Embedded coding agents: how APIWeave launches agent CLIs, the per-session
  MCP config and briefing files it writes, and the PTY host process.
- Git sync and GitHub/GitLab sign-in: how APIWeave runs `git`, `gh` and `glab`,
  handles account tokens, and what it writes to a workspace repository.
- The `apiweave run` CLI and the `@apiweave/cli` package, including how it reads
  secrets and masks them in output and reports.
- The update channel: the release manifests, update signatures and the in-app
  updater.

Vulnerabilities in the agent CLIs, `git`, `gh` or `glab` themselves belong with
their own projects.
