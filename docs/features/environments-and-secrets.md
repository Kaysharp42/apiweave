# Environments and Secrets

*How to create environments, declare variables, attach them to workflows, and resolve secret values at run time in APIWeave 1.0.*

## Prerequisites

- [Concepts](../getting-started/concepts.md), especially the Environment and Secret definitions.
- A working APIWeave instance with at least one signed-in user. See [Installation](../getting-started/installation.md) if you have not set it up yet.

## What Is an Environment

An environment is a named bundle of values you attach to a workflow before running it. The same workflow can point at different environments so you can hit staging, production, or a local server without editing the canvas.

Each environment holds four things:

- **Name and description** for display in the selector and manager.
- **Variables**, a flat key/value map that resolves into `{{env.NAME}}` placeholders at run time.
- **Secret keys**, a map of named slots for sensitive values such as API keys and client secrets.
- **OpenAPI/Swagger URL**, an optional document URL used by the importer when this environment is active.

Only one environment is *active* at a time. Switching the active environment is how you change which set of values the runner uses for `{{env.NAME}}` resolution.

## Creating an Environment

1. Open the **Environments** view from the top header.
2. Click **New Environment**.
3. Fill in a name and optional description.
4. Add one or more variables in the key/value editor. Each row is `KEY=VALUE` with one entry per line.
5. Add secret keys under **Manage Secrets**. Add the key name only at this step. See [Secrets](#secrets) for why values are handled separately.
6. Optionally paste a Swagger or OpenAPI document URL in the **OpenAPI/Swagger URL** field. See [OpenAPI/Swagger URL](#openapiswagger-url).
7. Save. The environment appears in the selector and is available to workflows.

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

Variables are plain key/value strings or numbers. They are stored in the environment document and resolved at run time in the order described in [Concepts](../getting-started/concepts.md#variable).

Common patterns:

- **Base URLs** for the host under test, such as `BASE_URL` and `AUTH_URL`.
- **Versioning constants** such as `API_VERSION=v2` referenced as `{{env.API_VERSION}}`.
- **Timeouts and limits** for non-secret knobs you want to vary per stage.
- **Feature flags** you want to toggle between environments without editing the canvas.

Variables are not encrypted. They are suitable for non-sensitive configuration. Anything that should stay secret belongs in a secret key, not a variable.

## Secrets

A secret is a sensitive value you do not want stored in plain workflow configuration, like an API key, a client secret, or a signing token. The environment document has a `secrets` map that holds the secret *keys* declared for that environment.

### What You Can Do in 1.0

- Declare secret keys in an environment via the **Manage Secrets** panel in the Environment Manager.
- See the list of secret keys for each environment, which is useful for documenting what a workflow expects.
- Use secret names in workflow fields as `{{secrets.NAME}}` placeholders. The runner resolves them against the active environment at run time and substitutes the plaintext value into the request field, header, body, or assertion path.
- Export and import workflows with secret references preserved, with values redacted to placeholders so the bundle stays shareable.
- Rotate the master encryption key by setting a new `SECRET_ENCRYPTION_KEY`, or rotate per-environment DEKs through the KEK rotation flow. See the [Encryption Guide](../operations/encryption.md) for the model and the rotation procedure.

For the canonical placeholder grammar and the order the runner resolves namespaces in, see the [Placeholders Reference](../reference/placeholders.md).

## Activating an Environment

Only one environment is active at a time. To switch:

1. Open the environment selector in the top header. It shows the name of the currently active environment.
2. Pick a different environment from the dropdown. The runner uses the new environment on the next run.
3. Active state is server-side, not per-tab, so every collaborator sees the same active environment.

Activating a new environment does not affect workflows that have already been saved with a specific environment attached. The active environment is the default for new runs and for runs that do not specify one.

## Duplicating Environments

Duplication is the fastest way to spin up a new stage. From the Environment Manager, open an environment and click **Duplicate**. The copy is created with:

- Name set to `<original name> (Copy)` so you can rename it.
- The same description.
- The same variables map.
- The same secret keys (the *names*, not values, since values are not stored).
- The same Swagger/OpenAPI URL, if one was set.

The duplicate is created inactive. Activate it after you edit the variables for the new stage.

## Deleting Environments

Deletion is destructive and is blocked by a reference check. APIWeave looks for workflows that still attach to the environment, and refuses to delete the environment if any are found.

To delete an environment:

1. Open the Environment Manager.
2. Find the environment you want to remove.
3. Click **Delete**.
4. If any workflow is still attached, the request fails with a `409 Conflict` and a message listing how many workflows reference the environment. Detach or reassign those workflows first, then retry.

Workflows that reference a deleted environment fall back to the active environment at run time, or fail with a clear error if no environment is active.

## OpenAPI/Swagger URL

Each environment can pin an OpenAPI or Swagger document URL. The URL is a convenience for the **Import** flow on the canvas: when this environment is active, **Refresh** in the canvas toolbar re-fetches the document and updates the available endpoint templates.

Set the URL during environment creation or edit it later. The URL must be reachable from the APIWeave backend, and the OpenAPI/Swagger import guide covers which document formats are accepted. See [Swagger and OpenAPI Import](swagger-import.md) for the full importer behavior and any security constraints on reachable hosts.

## Troubleshooting

- **If `{{env.BASE_URL}}` comes back as plain text in the response**, the active environment does not define that key. Open the Environment Manager, add the variable, and run again.
- **If a workflow references a deleted environment**, the workflow continues to exist but its runs fall back to the active environment. Open the workflow's settings, pick a valid environment, and save.
- **If deletion returns `409 Conflict`**, one or more workflows still attach to the environment. Find them via the workflow list filter, reassign or detach, then delete.
- **If a `{{secrets.NAME}}` placeholder shows up literally in the request URL or body**, the key is not declared on the active environment, or the stored ciphertext cannot be decrypted. Open the Environment Manager, confirm the key exists, and check that `SECRET_ENCRYPTION_KEY` matches the value the backend was started with. The full diagnostic path is in the [Encryption Guide](../operations/encryption.md).

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Placeholders Reference](../reference/placeholders.md)
- [Encryption Guide](../operations/encryption.md)
- [Swagger and OpenAPI Import](swagger-import.md)
- [Collections](collections.md)
