# Environments and Secrets

*How APIWeave scopes environments and secrets on your local machine. Covers the encrypted secret store, the metadata-only display, and the scope chain that resolves `{{secrets.NAME}}`.*

## Prerequisites

- [Concepts](../getting-started/concepts.md), especially the Environment and Secret definitions.
- A working APIWeave desktop app. See [Installation](../getting-started/installation.md) if you have not set it up yet.

## What Is an Environment

An environment is a named bundle of variables on your local machine. Every environment lives in the SQLite database under your user data directory. A run selects exactly one environment explicitly. There is no global "active" environment flag. The selected environment is the one whose variables feed `{{env.*}}` and whose secret store wins the scope chain for `{{secrets.*}}`.

Each environment holds three things:

- **Name and description** for display in the selector and manager.
- **Variables**, a flat key/value map that resolves into `{{env.NAME}}` placeholders at run time.
- **An optional Swagger or OpenAPI URL** used by the importer when this environment is active.

## Creating an Environment

1. Open the **Environments** page from the header.
2. Click **New environment**.
3. Fill in a name and optional description.
4. Add one or more variables in the key/value editor. Each row is `KEY=VALUE` with one entry per line.
5. Optionally paste a Swagger or OpenAPI document URL in the **OpenAPI/Swagger URL** field. See [Swagger and OpenAPI Import](swagger-import.md) for the importer behavior.
6. Save. The environment appears in the selector and is available to runs.

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

Variables are not encrypted. They are suitable for non-sensitive configuration. Anything that should stay secret belongs in a secret, not a variable.

## Secrets

A secret is a sensitive value you do not want stored in plain workflow configuration, like an API key, a client secret, or a signing token. Secrets are write-only at every layer. The plain value is submitted through a Libsodium sealed box, persisted as envelope-encrypted ciphertext under the per-install keyfile, and never returned through any read path.

### Secret Scopes

Secrets live at one of two scopes:

| Scope | Visible to |
|-------|------------|
| `workspace` | Every workflow in the local database |
| `environment` | Workflows that select the environment |

The scope of a secret is fixed at creation time. The same secret cannot move between scopes; delete and recreate if you need a different scope.

### The Scope Chain

`{{secrets.NAME}}` resolves through a fixed chain, with the first scope that declares the key winning:

1. The selected environment's secret store.
2. The workspace secret store.

The chain is fixed and lives entirely on your machine. There are no other scopes. The chain is read-only. A user who can write a workspace secret cannot write the same key as an environment secret; the environment editor is the only path to the environment scope.

When a secret overrides a same-named secret at the broader scope, the secret's metadata shows an `isOverride` flag and the scope it shadows. The UI surfaces this on the secret detail page so you know the broader value is no longer effective in that scope.

### Metadata-Only Display

The **Secrets** page shows metadata only. The list, detail, and history views display the secret name, scope, key id (the per-scope Libsodium keypair fingerprint), created and updated timestamps, and an `isOverride` flag when applicable. The plaintext value, the ciphertext, the private key, and the unwrapped DEK never appear in the UI.

A read API that returns the plaintext is not part of the surface. Treat any tool that claims to return a plaintext value as a security bug.

### Libsodium Write-Only Ingress

The renderer encrypts the new value against the scope's public key with a Libsodium sealed box before the write request leaves. The main process never accepts a plaintext secret value on a write path, and the UI does not offer a paste field. The write flow is the only path to add a secret.

```text
1. UI fetches the scope's public key.
2. UI encrypts the value with a sealed box.
3. UI sends the ciphertext to the main process over IPC.
4. Main process opens the sealed box with the scope's private key.
5. Main process re-encrypts the plaintext with the per-install DEK wrapped by the keyfile.
6. Main process stores the envelope ciphertext. The plaintext is gone from memory.
```

After the write, the UI clears the in-memory value state, the modal closes, and the metadata list updates. The value cannot be re-entered through the UI; the only path is the Libsodium write flow against the scope's current public key.

### What the Runtime Sees

When a run starts, the runner walks the scope chain and resolves each `{{secrets.NAME}}` placeholder against the matching scope's ciphertext. The decrypted plaintext exists only in the runtime path that builds the request, header, body, or assertion path. The masking layer scrubs the plaintext before the result is written to the database, so the run history holds the request shape with the secret replaced by a `<SECRET>` placeholder.

## Selecting an Environment for a Run

The canvas toolbar carries an environment selector. The selector lists every environment in the local database. Pick one before clicking **Run**. The selected environment is the one whose variables and secret overrides apply to the run.

## Duplicating Environments

Duplication is the fastest way to spin up a new stage. From the environment settings, open an environment and click **Duplicate**. The copy is created with:

- Name set to `<original name> (Copy)` so you can rename it.
- The same description.
- The same variables map.
- The same Swagger or OpenAPI URL, if one was set.
- No secrets. Secrets are write-only and never copy across environments. Re-create the secrets in the new environment through the Libsodium write flow.

The duplicate is not marked default. Mark it default manually if you want it preselected for new runs.

## Deleting Environments

Deletion is destructive and is blocked by a reference check. The app looks for workflows that still reference the environment, and refuses to delete it if any are found.

To delete an environment:

1. Open the **Environments** page.
2. Find the environment you want to remove.
3. Click **Delete**.
4. If any workflow is still attached, the request fails with a `409 Conflict` and a message listing how many workflows reference the environment. Detach or reassign those workflows first, then retry.

Deleting an environment also deletes every secret stored at that environment scope.

## OpenAPI/Swagger URL

Each environment can pin an OpenAPI or Swagger document URL. The URL is a convenience for the **Import** flow on the canvas: when this environment is active, **Refresh** in the canvas toolbar re-fetches the document and updates the available endpoint templates.

Set the URL during environment creation or edit it later. The URL must be reachable from the APIWeave main process, and the OpenAPI or Swagger import guide covers which document formats are accepted. See [Swagger and OpenAPI Import](swagger-import.md) for the full importer behavior and any security constraints on reachable hosts.

## Troubleshooting

- **If `{{env.BASE_URL}}` comes back as plain text in the response**, the selected environment does not define that key. Open the **Environments** page, add the variable, and run again.
- **If `{{secrets.NAME}}` resolves to an empty string**, no scope in the chain declares that key. Open **Secrets** for the selected environment and the workspace (in that order), and add the key through the Libsodium write flow.
- **If a secret write is rejected with a key mismatch**, the scope's public key rotated between the time the UI fetched it and the time the write arrived. The UI retries automatically; if the failure persists, reload the **Secrets** page to fetch the fresh public key.
- **If deletion returns `409 Conflict`**, one or more workflows still attach to the environment. Find them via the workflow list filter, reassign or detach, then delete.
- **If a stored secret value seems unreadable after copying the database to a new machine**, the keyfile from the source machine is not on the destination. Copy the keyfile too, or re-enter the secrets through the write flow.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Placeholders Reference](../reference/placeholders.md)
- [Swagger and OpenAPI Import](swagger-import.md)
- [Projects](projects.md)
