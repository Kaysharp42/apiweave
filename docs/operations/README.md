# Operations

*Run APIWeave in production. These four guides cover the concerns that show up the moment the platform leaves your laptop: who can sign in, what production traffic is allowed to do, how the four components get deployed and scaled, and where to look first when something breaks.*

## Prerequisites

- A working APIWeave instance built from the [Installation](../getting-started/installation.md) guide and a completed [first workflow](../getting-started/first-workflow.md).
- Read the [Concepts](../getting-started/concepts.md) glossary so the cross-references in the guides below land.

## Auth and Access

- [Authentication](authentication.md): the SSO model, the local admin bootstrap, session policy, approved domains, and the OAuth provider setup scheduled for 1.1.

## Security

- [Security](security.md): the production security model, CSRF and CORS guardrails, webhook and MCP auth, SSRF protection, secret masking, the worker exposure caveat, and the pre-launch checklist.

## Deployment

- [Deployment](deployment.md): Docker Compose, environment variables, MongoDB, reverse proxies, scaling, backups, observability, and a pre-production checklist for self-hosters.

## Troubleshooting

- [Troubleshooting](troubleshooting.md): the central FAQ for "why does it work this way" questions, plus pointers to the per-feature troubleshooting sections for operational "if X happens, do Y" guidance.

## When to Use These Docs

Reach for this index when you are about to expose APIWeave to anyone outside the deployment team, hardening an existing production install, or chasing a failure that the per-feature troubleshooting sections did not catch. For day-to-day workflow building, use the [feature guides](../features/README.md) instead.

## Related

- [Documentation Hub](../README.md)
- [Getting Started](../getting-started/README.md)
- [Features](../features/README.md)
- [Reference](../reference/README.md)
- [Environment Variables Reference](../reference/environment-variables.md)
