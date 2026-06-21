# Operations

*Run APIWeave 2.0 in production. These guides cover the concerns that show up the moment the platform leaves your laptop: who can sign in, what production traffic is allowed to do, how the components get deployed and scaled, how secrets are encrypted at rest, how environment protection works, and where to look first when something breaks.*

## Prerequisites

- A working APIWeave 2.0 instance built from the [Installation](../getting-started/installation.md) guide and a completed [first workflow](../getting-started/first-workflow.md).
- Read the [Concepts](../getting-started/concepts.md) glossary so the cross-references in the guides below land.

## Auth and Access

- [Authentication](authentication.md): the SSO model, the per-instance owner bootstrap, the personal workspace, the organization and workspace context, session policy, approved domains, the OAuth provider setup, and the [`DEPLOYMENT_MODE` switch](authentication.md#deployment-mode) that selects between single-user self-hosting and the full multi-tenant surface.

## Security

- [Security](security.md): the production security model, scoped trust boundaries, CSRF and CORS guardrails, webhook and MCP auth, SSRF protection, secret masking, the audit trail, the worker exposure caveat, and the pre-launch checklist.
- [Encryption](encryption.md): the per-scope Libsodium keypair model, the write-only sealed-box ingress, the master KEK, the keyring rotation flow, and the threat model.

## Deployment

- [Deployment](deployment.md): Docker Compose, the destructive database reset on upgrade, environment variables, MongoDB, reverse proxies, scaling, backups, observability, and a pre-production checklist for self-hosters.

## Environment Protection

- [Environment Protection](environment-protection.md): required reviewers, self-approval, the trusted-token bypass, the approval queue, and the recommended patterns per environment type.

## Audit

- [Audit Log](audit.md): the append-only event log, the filters, the JSON export, and the pre-destructive-reset snapshot flow.

## Troubleshooting

- [Troubleshooting](troubleshooting.md): the central FAQ for "why does it work this way" questions, plus pointers to the per-feature troubleshooting sections for operational "if X happens, do Y" guidance.

## When to Use These Docs

Reach for this index when you are about to expose APIWeave to anyone outside the deployment team, hardening an existing production install, deciding whether a workflow should run against a protected environment, or chasing a failure that the per-feature troubleshooting sections did not catch. For day-to-day workflow building, use the [feature guides](../features/README.md) instead.

## Related

- [Documentation Hub](../README.md)
- [Getting Started](../getting-started/README.md)
- [Features](../features/README.md)
- [Reference](../reference/README.md)
- [Environment Variables Reference](../reference/environment-variables.md)
