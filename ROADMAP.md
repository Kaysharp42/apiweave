# Roadmap

This roadmap is subject to change. APIWeave 2.0 is the first release tracked as a stable public surface, and post-2.0 work tracks the items below. Priorities shift based on user feedback.

## Shipped in 2.0

The 2.0 release is the GitHub-style multi-tenant refactor. Personal and organization-owned workspaces, organizations with teams and members, projects (formerly collections), scoped environments, scoped secrets with a GitHub-like override chain, Libsodium write-only secret ingress, per-scope keypairs, environment protection with required reviewers and the trusted-token bypass, scoped service tokens, a rebuilt scoped MCP tool surface, and an append-only audit log with a JSON export. The full 2.0 surface is in the [Changelog](../CHANGELOG.md).

## Next (2.1)

- **Workspace transfer.** Move a workspace from one organization to another, with a confirmation flow and an audit event.
- **Audit retention controls.** Per-org and per-workspace retention windows, with the export as the canonical long-term store.
- **Audit search.** Full-text search over the audit log context map, scoped to the calling user's permissions.
- **Service token narrowing UI.** Walk an operator through the minimum permission set a token actually needs, based on the call history.
- **Project templates.** Export a project as a workspace-level template that other workspaces in the same org can import.
- **Scheduled runs.** Cron-style triggers per project, with the same scoped service token model as webhooks.

## Later (2.2+)

- **Advanced billing UI.** Per-organization seat counts, with the per-org role model already in place.
- **Advanced security policy center.** Org-level rules for secret scope visibility, environment protection defaults, and service token expiry floors.
- **GitHub App style integration tokens.** A first-class "app" actor type in the audit log, distinct from user and service_token.
- **Cross-org environment sharing.** Allow an org to expose an environment to specific external orgs, with a grant record.
- **Real-time collaboration.** Multiple users on the same canvas, with the change stream written to the audit log.
- **Workflow history.** Per-workflow diff view across revisions, with the editor's auto-save as the source.

## How to influence

Open or comment on a [GitHub Issue](https://github.com/apiweave/apiweave/issues) with your use case. The roadmap above shifts toward the work the community asks for first.
