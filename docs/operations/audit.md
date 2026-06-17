# Audit Log

*How APIWeave 2.0 records every meaningful action in an append-only event log, how the audit page filters and paginates events, and how to take a portable JSON snapshot before any destructive operation.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the organization, workspace, environment, service token, and audit event vocabulary used in this guide.
- [Authentication](authentication.md) for the per-instance owner, invite flow, and session model.
- A workspace or organization you can audit. Personal workspace audit requires no extra setup; organization audit requires the `audit:read` permission on the org or workspace.

## What Is the Audit Log

The audit log is an append-only event stream. Every meaningful action in APIWeave 2.0 writes one event. The event carries the actor, the action, the scope, the resource, the time, and a context map of additional metadata. The event id is monotonic. Events are never updated and never deleted through any UI or API.

The audit log is the source of truth for "who did what, when". Use it for incident review, compliance evidence, and operational debugging. Take a JSON snapshot before any destructive operation, including the destructive database reset that the 2.0 line requires for a 1.0 to 2.0 upgrade.

## Event Model

Every event has the same shape:

| Field | Description |
|-------|-------------|
| `eventId` | Monotonic event identifier. |
| `actor` | The actor type. One of `user`, `org_app`, `service_token`, `mcp_client`, `webhook_token`, `system_migration`. |
| `actorId` | The actor's identifier (user id, service token id, and similar). |
| `action` | The action that happened, in dotted form (for example `env.activate`, `secret.write`, `member.remove`, `run.start`, `audit.export`). |
| `scope` | The scope the action was taken against. One of `org`, `workspace`, `environment`. |
| `scopeId` | The scope's identifier. |
| `resourceType` | The resource type the action touched (for example `workflow`, `project`, `environment`, `secret`, `service_token`, `webhook`). |
| `resourceId` | The resource's identifier. |
| `context` | Free-form key/value map with action-specific metadata. The audit page renders the keys but applies the same value-aware masking as the run history. Secret values are never present. |
| `createdAt` | ISO 8601 timestamp the event was written. |

The audit page shows the event id, time, actor, action, scope, resource type, and resource id. The context map is collapsed by default. Open an event to see the full context. The context is metadata only; it never carries a secret value, ciphertext, or private key.

## What Gets Logged

The audit log captures every action that affects an organization, a workspace, or an environment, including:

- **Organizations**: create, update, member role change, member removal, last-owner protection trip, invite create, invite cancel, team create, team delete, team permission grant, team permission revoke.
- **Workspaces**: create, update, slug change, outside collaborator add, outside collaborator remove.
- **Projects**: create, update, delete, workflow added, workflow removed, workflow order saved, export, import.
- **Workflows**: create, update, delete, run start, run cancel, run complete, run failure, run approval granted, run approval denied.
- **Environments**: create, update, delete, default flag change, allowed workspace added, allowed workspace removed.
- **Environment Protection**: protection policy update, required reviewer added, required reviewer removed, self-approval toggle, bypass policy update, allowlist change.
- **Secrets**: public key fetched, secret write, secret rotate, secret delete, secret resolution at run time, override chain hop (which scope's value won).
- **Service Tokens**: create, rotate, narrow, revoke, used for an action.
- **Webhooks**: create, update, delete, regenerate credentials, execute success, execute failure (with the failure reason).
- **Audit**: export (the export action itself is logged so the snapshot is itself auditable).
- **Authentication**: first owner bootstrap, login, logout, role change, session rotation.
- **System**: destructive database reset, schema migration, backup, restore.

The list grows as the surface grows. Treat the running server as the source of truth for the exact set of actions.

## Viewing the Audit Log

Open the audit page from the header. The URL shape is one of:

- `/personal/audit` for the personal workspace.
- `/<orgSlug>/<workspaceSlug>/audit` for an organization-owned workspace.
- `/<orgSlug>/audit` for the organization.

The page shows a paginated list with a default page size of 50. The page size is adjustable in the page footer. The list is sorted by `createdAt` descending, with the most recent event first.

### Filters

The audit page supports six filters. Filters apply together as an AND. Empty filters match all events.

| Filter | Description |
|--------|-------------|
| **Actor** | The actor id (user id, service token id, webhook token id, and similar). |
| **Action** | The dotted action name, with prefix match. `secret.` matches every secret action. |
| **Scope** | One of `org`, `workspace`, `environment`. |
| **Resource type** | One of the resource types (for example `workflow`, `project`, `environment`, `secret`). |
| **From** | ISO 8601 timestamp, inclusive. |
| **To** | ISO 8601 timestamp, inclusive. |

The filter bar resets when you navigate away from the page. Use the export to take a snapshot if you need to come back to a specific filter set.

### Event Detail

Click an event row to open the detail view. The detail view shows every field, including the context map. The context map renders keys only; values that match the secret-pattern detector are replaced with `<SECRET>` placeholders even in the audit view, as a defense-in-depth measure. The original event in the database is unchanged.

## Exporting the Audit Log

The audit page carries a **JSON export** action. The export downloads a single JSON file that contains every event that matches the current filter, in `createdAt` ascending order. The export includes the same fields as the live view, with the same value-aware masking on the context map.

The export is itself an audit event. The `audit.export` action records the actor, the filter set, the event count, and the SHA-256 hash of the exported file. The hash is also embedded in the export file's envelope, so an external archive can confirm the snapshot is intact.

Use the export before any destructive operation. The destructive database reset that the 2.0 install requires wipes the audit log with the rest of the database, so a snapshot is the only way to preserve history across an upgrade. Store the snapshot in a location that is not on the database host, and rotate the snapshot retention per your compliance policy.

## Retention

Default retention is set in the backend configuration and is per instance. The retention is a soft cap; events older than the retention window are purged in a background job. Set a longer retention for compliance-heavy deployments and a shorter one for dev and staging. The export is the canonical way to extend retention beyond the in-database window without changing the configuration.

## Troubleshooting

- **If the audit page returns `403 Forbidden`**, you do not have the `audit:read` permission on the requested scope. Ask an owner to grant the permission or visit the audit page for a scope you do have access to.
- **If an event is missing from the list**, expand the time range. The default page is the most recent 50 events. Use the From filter to widen the window.
- **If the JSON export is empty**, the filter set matched zero events. Clear the filters and retry.
- **If the export shows `<SECRET>` for a value you expected to see**, the value matched the secret-pattern detector. Audit events do not contain secret values by design. Check the secret's history in the Secrets page and the run history for that scope.
- **If a destructive reset is coming**, take a JSON export first. The reset wipes the audit log with the rest of the database.

## Related

- [Authentication](authentication.md) for the actor model and the bootstrap that creates the first owner.
- [Environments and Secrets](../features/environments-and-secrets.md) for the secret resolution events that the audit log captures.
- [Environment Protection](environment-protection.md) for the approval and bypass events.
- [MCP Integration](../features/mcp-integration.md) for the MCP tool surface whose actions are all audited.
- [Webhooks](../features/webhooks.md) for the webhook delivery events.
