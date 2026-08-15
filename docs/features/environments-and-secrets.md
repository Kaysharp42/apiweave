# Environments and Secrets

*How APIWeave scopes environments and secrets on your local machine. Covers the encrypted secret store, the metadata-only display, and the scope chain that resolves `{{secrets.NAME}}`.*

## Prerequisites

- [Concepts](../getting-started/concepts.md), especially the Environment and Secret definitions.
- A working APIWeave desktop app. See [Installation](../getting-started/installation.md) if you have not set it up yet.

## What Is an Environment

An environment is a named bundle of variables on your local machine. Every environment lives in the SQLite database under your user data directory. A run uses the environment you select for that workflow. The header's **Default environment** selector is a per-machine convenience: the environment you pick there is preselected in the canvas toolbar for new workflows, and the preference is remembered on this machine. The effective environment is the one whose variables feed `{{env.*}}` and whose secret store wins the scope chain for `{{secrets.*}}`.

Each environment holds four things:

- **Name and description** for display in the selector and manager.
- **Variables**, a flat key/value map that resolves into `{{env.NAME}}` placeholders at run time.
- **An optional base environment** it inherits plain variables from. See [Environment Inheritance](#environment-inheritance).
- **An optional Swagger or OpenAPI URL** used by the importer when this environment is active.

## Creating an Environment

1. Open the **Environments** page from the header.
2. Click **New environment**.
3. Fill in a name and optional description.
4. Optionally pick a **Base Environment** to inherit plain variables from. The picker lists the other environments in the workspace; see [Environment Inheritance](#environment-inheritance).
5. Add one or more variables in the key/value editor (one row per variable, key and value fields).
6. Optionally paste a Swagger or OpenAPI document URL in the **Swagger Doc URL** field. See [Swagger and OpenAPI Import](swagger-import.md) for the importer behavior.
7. Save. The environment appears in the selector and is available to runs.

Example variables for a typical staging environment:

```text
BASE_URL=https://api.staging.example.com
API_VERSION=v1
TIMEOUT_SECONDS=30
```

Use the values in any request field, header, or body:

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

## Environment Inheritance

Ten environments that share 90% of their variables do not need ten copies of those variables. An environment can extend a **base environment** in the same workspace and define only what differs.

At run time the effective variable set is the whole chain merged from the root down, with each descendant overriding the names it redefines:

```text
base            HOST=api.example.com   REGION=us   TIMEOUT=30
  └─ staging    HOST=api.staging.example.com
       └─ staging-eu   REGION=eu

Running against staging-eu resolves:
  HOST=api.staging.example.com   (from staging)
  REGION=eu                      (from staging-eu)
  TIMEOUT=30                     (from base)
```

Set it from the environment editor's **Base Environment** picker. The editor then shows the inherited variables above your own, muted and read-only, each labelled with the environment it came from, and marks any that your environment overrides — so the effective set is visible without running anything.

Three things to know:

- **Plain variables only.** Secrets are not inherited. `{{secrets.NAME}}` still resolves through the fixed `environment > workspace` chain described in [The Scope Chain](#the-scope-chain), which inheritance does not touch. An environment that extends another does not gain access to its base's secrets.
- **Loops are refused.** An environment cannot extend itself, cannot extend an environment outside its workspace, and cannot extend one whose own chain leads back to it. The picker hides those choices and the write is rejected with a validation error if something tries anyway. Chains are followed at most 8 levels deep.
- **The link is local for now.** `baseEnvironmentId` is not part of the Cloud sync payload. An environment that syncs to another machine arrives with its own variables but no base link, so the receiving machine resolves only what that environment defines directly. Keep the shared values in the environment itself if a run has to be reproducible on a second machine.

## Secrets

A secret is a sensitive value you do not want stored in plain workflow configuration, like an API key, a client secret, or a signing token. Secrets are write-only at every layer. The plain value is submitted through a Libsodium sealed box against the install's public key; the sealed ciphertext is stored verbatim in the local store and opened at run time with the key derived from the per-install keyfile. It is never returned through any read path.

### Secret Scopes

Secrets live at one of two scopes:

| Scope | Visible to |
|-------|------------|
| `workspace` | Any workflow in the workspace on this machine, never synced |
| `environment` | Workflows that select the environment |

The scope of a secret is fixed at creation time. The same secret cannot move between scopes; delete and recreate if you need a different scope.

Secret values are never synced: when Cloud sync is in use, only secret references and structure travel, and secret values are rejected from sync payloads. Each machine keeps its own secrets, so a synced workflow is run against the keys stored locally on the machine that runs it.

### The Scope Chain

`{{secrets.NAME}}` resolves through a fixed chain, with the first scope that declares the key winning:

1. The selected environment's secret store.
2. The workspace secret store.

The chain is fixed and lives entirely on your machine. There are no other scopes. The chain is read-only: once a secret is written it can be deleted or overwritten through the write flow, but never read back.

### Metadata-Only Display

The **Secrets** page shows metadata only: the list and detail views display the secret name, scope, key id (the install keypair's scope label), and created and updated timestamps. The plaintext value, the ciphertext, and the private key never appear in the UI.

A read API that returns the plaintext is not part of the surface. Treat any tool that claims to return a plaintext value as a security bug.

### Libsodium Write-Only Ingress

The renderer encrypts the new value against the install's public key with a Libsodium sealed box before the write request leaves. The main process never accepts a plaintext secret value on a write path, and the UI does not offer a paste field. The write flow is the only path to add a secret.

```text
1. UI fetches the install's public key.
2. UI encrypts the value with a sealed box.
3. UI sends the ciphertext to the main process over IPC.
4. Main process stores the sealed ciphertext verbatim. No plaintext reaches it.
```

After the write, the UI clears the in-memory value state, the modal closes, and the metadata list updates. At run time, the main process opens the sealed box with the key derived from the per-install keyfile and substitutes the plaintext into the request field, header, or body. The masking layer scrubs the plaintext before the result is written to the database, so the run history holds the request shape with the secret replaced by a `<SECRET>` placeholder.

## Selecting an Environment for a Run

The canvas toolbar carries an environment selector. The selector lists every environment in the local database. Pick one before clicking **Run**. The selected environment is the one whose variables and secret overrides apply to the run.

## Deleting Environments

Deleting an environment is immediate: the environment row is removed and the name leaves the selector. Deleting the environment marked as your default on this machine is refused — pick a different default first.

To delete an environment:

1. Open the **Environments** page.
2. Find the environment you want to remove.
3. Click **Delete**.

Workflows that still have the deleted environment selected fall back to the header default on their next run. Environment-scoped secrets are keyed to the environment's ID and are not automatically deleted with it; re-create the environment to bind new secrets.

## OpenAPI/Swagger URL

Each environment can pin an OpenAPI or Swagger document URL. The URL is a convenience for the **Import** flow on the canvas: when this environment is active, **Refresh** in the canvas toolbar re-fetches the document and updates the available endpoint templates.

Set the URL during environment creation or edit it later. The URL must be reachable from the APIWeave main process through the same HTTP-safety guard that the runner uses, and the OpenAPI or Swagger import guide covers which document formats are accepted. Hosts on private networks are blocked by default; enable **Settings → Private networks** to allow them (see [Swagger and OpenAPI Import](swagger-import.md) for the full importer behavior and reachability rules).

## Troubleshooting

- **If `{{env.BASE_URL}}` comes back as plain text in the response**, the selected environment does not define that key. Open the **Environments** page, add the variable, and run again.
- **If `{{secrets.NAME}}` is not substituted and appears as literal text**, no scope in the chain declares that key. Open **Secrets** for the selected environment and the workspace store (in that order), and add the key through the Libsodium write flow.
- **If an inherited variable does not reach the run**, check the chain in the environment editor: only variables shown in the muted **Inherited Variables** rows are in the effective set, and a name you also define locally is overridden by your own value.
- **If a base environment is missing from the picker**, it is either this environment itself or an environment whose own chain leads back here. Both would form a cycle and are excluded on purpose.
- **If an inherited variable resolves on one machine but not another**, the second machine received the environment through Cloud sync without the base link, which does not sync. Define the value on the environment directly.
- **If a stored secret value seems unreadable after copying the database to a new machine**, the keyfile from the source machine is not on the destination. Copy `keyfile.json` from the source's user data directory too, or re-enter the secrets through the write flow.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Placeholders Reference](../reference/placeholders.md)
- [Swagger and OpenAPI Import](swagger-import.md)
- [Projects](projects.md)
