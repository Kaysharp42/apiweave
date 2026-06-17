# Environments and Secrets

*How APIWeave 2.0 scopes environments and secrets across the user, organization, workspace, and environment boundaries. Covers the Libsodium write-only secret model, the metadata-only display, the scope override chain that resolves `{{secrets.NAME}}`, and the fact that runtime secret input is removed.*

## Prerequisites

- [Concepts](../getting-started/concepts.md), especially the Environment, Secret, and Workspace definitions.
- A working APIWeave 2.0 instance with at least one signed-in user. See [Installation](../getting-started/installation.md) if you have not set it up yet.
- The [Encryption Guide](../operations/encryption.md) for the per-scope keypair model and the master KEK.

## What Is an Environment

An environment is a named bundle of variables and a scope. Every environment in APIWeave 2.0 lives at one of three scopes:

- **User scope** (`/api/users/me/environments`): the personal workspace's environments, available only to the user who created them.
- **Organization scope** (`/api/orgs/{orgSlug}/environments`): the organization's environments, available to workspaces that the organization allowlists.
- **Workspace scope** (`/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/environments`): the workspace's environments, available to every workflow in that workspace.

A run selects exactly one environment explicitly. There is no global "active" environment flag. The selected environment is the one whose variables feed `{{env.*}}` and whose secret store wins the override chain for `{{secrets.*}}`.

Each environment holds four things:

- **Name and description** for display in the selector and manager.
- **Variables**, a flat key/value map that resolves into `{{env.NAME}}` placeholders at run time.
- **A default flag** for workspace environments. Each workspace has exactly one default environment. The default is preselected when you open a new run.
- **An optional Swagger or OpenAPI URL** used by the importer when this environment is active.

For organization environments, the environment also carries an `allowedWorkspaceIds` list that restricts which workspaces can see and select it. The default for a new organization environment is no workspaces (it is invisible until you add at least one).

For workspace environments, the environment may also carry a [protection policy](../operations/environment-protection.md) that queues runs behind approvals.

## Creating an Environment

1. Open the **Environments** page from the header. The URL shape is one of the three scope prefixes above.
2. Click **New environment**.
3. Fill in a name and optional description.
4. Add one or more variables in the key/value editor. Each row is `KEY=VALUE` with one entry per line.
5. For an organization environment, add the workspaces that should see it under **Allowed workspaces**.
6. Optionally paste a Swagger or OpenAPI document URL in the **OpenAPI/Swagger URL** field. See [Swagger and OpenAPI Import](swagger-import.md) for the importer behavior.
7. Save. The environment appears in the selector and is available to runs in the allowed scopes.

Example variables for a typical staging environment:

```text
BASE_URL=https://api.staging.example.com
API_VERSION=v1
TIMEOUT_SECONDS=30
```

Use the values in any request field, header, body, or assertion path:

```text
{{env.BASE_URL}}/users
{{env.BASE_URL}}/orders/{{variables.orderId}}
```

## Environment Variables

Variables are plain key/value strings or numbers. They are stored in the environment document and resolved at run time in the order described in [Placeholders Reference](../reference/placeholders.md#environment-variables).

Common patterns:

- **Base URLs** for the host under test, such as `BASE_URL` and `AUTH_URL`.
- **Versioning constants** such as `API_VERSION=v2` referenced as `{{env.API_VERSION}}`.
- **Timeouts and limits** for non-secret knobs you want to vary per stage.
- **Feature flags** you want to toggle between environments without editing the canvas.

Variables are not encrypted. They are suitable for non-sensitive configuration. Anything that should stay secret belongs in a scoped secret, not a variable.

## Secrets

A secret is a sensitive value you do not want stored in plain workflow configuration, like an API key, a client secret, or a signing token. Secrets in 2.0 are write-only at every layer. The plain value is submitted through a Libsodium sealed box, persisted as envelope-encrypted ciphertext under a master KEK, and never returned through any read path.

### Secret Scopes

Secrets live at one of four scopes:

| Scope | Owner | Visible to |
|-------|-------|------------|
| `user` | The current user | The user, and any workspace or environment the user has bound it to |
| `organization` | An organization | Members of the organization, plus workspaces the organization allowlists |
| `workspace` | A workspace | Members of the workspace with secret read permission |
| `environment` | A specific environment | Workflows that select the environment |

The scope of a secret is fixed at creation time. The same secret cannot move between scopes; delete and recreate if you need a different scope.

### The Override Chain

`{{secrets.NAME}}` resolves through a fixed chain, with the first scope that declares the key winning:

1. The selected environment's secret store.
2. The workflow's workspace secret store.
3. The organization secret store (if the workflow's workspace is organization-owned).
4. The current user's personal secret store, but only when the workspace or environment has an explicit binding record for that user.

The chain is GitHub-like. The selected environment is the narrowest scope and wins, then the workspace, then the organization. Personal secrets participate only through a binding record. There is no other way for a personal secret to reach a run.

The override chain is read-only. A user who can write a workspace secret cannot write the same key as an environment secret; the environment editor is the only path to the environment scope. The chain exists to let a workspace or organization set a default and let a specific environment override it for one deployment.

When a secret overrides a same-named secret at a broader scope, the secret's metadata shows an `isOverride` flag and the scope it shadows. The UI surfaces this on the secret detail page so the operator knows the broader value is no longer effective in that scope.

### Metadata-Only Display

The Secrets page shows metadata only. The list, detail, and audit views display the secret name, scope, key id (the per-scope Libsodium keypair fingerprint), created and updated timestamps, and an `isOverride` flag when applicable. The plaintext value, the ciphertext, the private key, and the unwrapped DEK never appear in the UI.

A read API that returns the plaintext is not part of the surface. Treat any tool that claims to return a plaintext value as a security bug.

### Libsodium Write-Only Ingress

The browser or agent encrypts the new value against the scope's public key with a Libsodium sealed box before the write request leaves. The backend never accepts a plaintext secret value on a write path, and the UI does not offer a paste field. The write flow is the only path to add a secret.

```text
1. UI fetches the scope's public key.
2. UI encrypts the value with a sealed box.
3. UI POSTs the ciphertext to the write endpoint.
4. Backend opens the sealed box with the scope's private key.
5. Backend re-encrypts the plaintext with the per-instance DEK wrapped by the master KEK.
6. Backend stores the envelope ciphertext. The plaintext is gone from memory.
```

After the write, the UI clears the in-memory value state, the modal closes, and the metadata list updates. The value cannot be re-entered through the UI; the only path is the Libsodium write flow against the scope's current public key.

### What the Runtime Sees

When a run starts, the runner walks the override chain and resolves each `{{secrets.NAME}}` placeholder against the matching scope's ciphertext. The decrypted plaintext exists only in the runtime path that builds the request, header, body, or assertion path. The masking layer scrubs the plaintext before the result is written to the database, so the run history holds the request shape with the secret replaced by a `<SECRET>` placeholder.

The audit log records the resolution event (actor, scope, secret name, key id) without the value. See [Audit Log](../operations/audit.md).

## Selecting an Environment for a Run

The canvas toolbar carries an environment selector. The selector lists the environments visible to the current workspace:

- All workspace environments, with the default one preselected.
- All organization environments whose `allowedWorkspaceIds` includes the current workspace.
- The current user's personal environments, but only when a binding record exists.

Pick one before clicking **Run**. The selected environment is the one whose variables and secret overrides apply to the run. If the environment is protected, the run queues behind approvals before it starts. See [Environment Protection](../operations/environment-protection.md).

## Duplicating Environments

Duplication is the fastest way to spin up a new stage. From the environment settings, open an environment and click **Duplicate**. The copy is created with:

- Name set to `<original name> (Copy)` so you can rename it.
- The same description.
- The same variables map.
- The same Swagger or OpenAPI URL, if one was set.
- No secrets. Secrets are write-only and never copy across environments or scopes. Re-create the secrets in the new environment through the Libsodium write flow.

The duplicate inherits the scope of the original. The duplicate is not the default for any workspace; mark it default manually if you want it preselected for new runs.

## Deleting Environments

Deletion is destructive and is blocked by a reference check. APIWeweave looks for workflows that still reference the environment, and refuses to delete it if any are found.

To delete an environment:

1. Open the Environments page for the scope.
2. Find the environment you want to remove.
3. Click **Delete**.
4. If any workflow is still attached, the request fails with a `409 Conflict` and a message listing how many workflows reference the environment. Detach or reassign those workflows first, then retry.

Deleting an environment also deletes every secret stored at that environment scope and every approval record tied to the environment. Organization environments are blocked if any allowed workspace still references them.

## OpenAPI/Swagger URL

Each environment can pin an OpenAPI or Swagger document URL. The URL is a convenience for the **Import** flow on the canvas: when this environment is active, **Refresh** in the canvas toolbar re-fetches the document and updates the available endpoint templates.

Set the URL during environment creation or edit it later. The URL must be reachable from the APIWeave backend, and the OpenAPI or Swagger import guide covers which document formats are accepted. See [Swagger and OpenAPI Import](swagger-import.md) for the full importer behavior and any security constraints on reachable hosts.

## Troubleshooting

- **If `{{env.BASE_URL}}` comes back as plain text in the response**, the selected environment does not define that key. Open the Environments page, add the variable, and run again.
- **If a workflow cannot see an organization environment**, the environment's `allowedWorkspaceIds` does not include the workflow's workspace. Open the environment settings and add the workspace.
- **If `{{secrets.NAME}}` resolves to an empty string**, no scope in the override chain declares that key. Open Secrets for the selected environment, the workspace, and the organization (in that order), and add the key through the Libsodium write flow. A missing user binding also blocks a personal secret.
- **If a secret write is rejected with a key mismatch**, the scope's public key rotated between the time the UI fetched it and the time the write arrived. The UI retries automatically; if the failure persists, reload the Secrets page to fetch the fresh public key.
- **If deletion returns `409 Conflict`**, one or more workflows still attach to the environment. Find them via the workflow list filter, reassign or detach, then delete.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Placeholders Reference](../reference/placeholders.md)
- [Encryption Guide](../operations/encryption.md)
- [Environment Protection](../operations/environment-protection.md)
- [Audit Log](../operations/audit.md)
- [Swagger and OpenAPI Import](swagger-import.md)
- [Projects](projects.md)
