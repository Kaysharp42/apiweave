# Security Policy

## Supported Versions

APIWeave is pre-1.0 and ships from a single release line. Only the latest
release gets security fixes; the in-app updater moves installs to it.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| Anything older | No — update first |

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

In scope: the desktop app, its local MCP bridge, the update channel, and how
secrets are stored, resolved, masked and exported.
