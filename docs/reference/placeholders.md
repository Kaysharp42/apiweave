# Placeholders

*Canonical reference for the four placeholder namespaces in APIWeave. Use this doc when you need the exact syntax for a placeholder, the order the runner resolves them in, what happens when a value is missing, and how the local scope chain works for secrets.*

## Prerequisites

None. This is a reference doc. Read [Concepts](../getting-started/concepts.md) first if you are new to variables, extractors, environments, or secrets.

## Table of Contents

- [Overview](#overview)
- [Namespaces](#namespaces)
- [Environment Variables](#environment-variables)
- [Workflow Variables](#workflow-variables)
- [Previous Node Result](#previous-node-result)
- [Secrets](#secrets)
- [The Scope Chain](#the-scope-chain)
- [Dynamic Functions](#dynamic-functions)
- [Substitution Order](#substitution-order)
- [Missing Values](#missing-values)
- [Common Mistakes](#common-mistakes)
- [Related](#related)

## Overview

Every placeholder in APIWeave uses double curly braces. The runner substitutes them before a request goes out, before an assertion is evaluated, and before any other field is read:

```text
{{namespace.name}}
```

The segment before the first dot is the **namespace**. The segment after the dot is the **key** (or, for `prev.*`, a JSONPath into the previous node's response object). There are four namespaces, plus dynamic functions, plus direct node-ID access (see below).

Placeholders work in request URLs, query parameters, headers, cookies, bodies, and assertion `expectedValue` fields. Two kinds of field are **not** interpolated: the HTTP method and the timeout are taken literally, and an assertion's `path` is not templated either.

## Namespaces

| Namespace     | Example                              | Source                                                       |
| ------------- | ------------------------------------ | ------------------------------------------------------------ |
| `env.*`       | `{{env.BASE_URL}}`                   | the selected environment                                     |
| `variables.*` | `{{variables.token}}`                | workflow variable (manual or extracted)                      |
| `prev.*`      | `{{prev.response.body.id}}`          | previous node result (`prev[0]` after a merge)               |
| `secrets.*`   | `{{secrets.API_KEY}}`        | the local scope chain (env > workspace)                       |
| functions     | `{{uuid()}}`                         | dynamic helper (uuid, timestamp, randomString, etc.)         |

The four data namespaces are tried in a fixed order. See [Substitution Order](#substitution-order) for the exact sequence.

## Environment Variables

`env.*` reads from the **selected** environment. A run selects one environment explicitly. Switching the environment between runs is how the same workflow targets staging, production, or a local server without editing the canvas.

```text
{{env.BASE_URL}}
{{env.API_VERSION}}
{{env.TIMEOUT_SECONDS}}
```

Build URLs by combining an env variable with a literal path:

```text
{{env.BASE_URL}}/users/{{variables.userId}}
```

Environment values are plain text. Do not put secrets there; use the `secrets.*` namespace instead. See [Environments and Secrets](../features/environments-and-secrets.md) for how to select and manage environments.

## Workflow Variables

`variables.*` reads from the workflow's own variable store. You create entries in the Variables panel or by attaching an extractor to an HTTP Request node. The value is available in any later node on the same run.

```text
{{variables.token}}
{{variables.userId}}
{{variables.cartId}}
```

Workflow variables persist for the duration of the run. After each completed node, the Variables panel shows the current value of every variable, including those written by extractors. See [Variables and Extractors](../features/variables-and-extractors.md) for how to add, edit, and delete variables.

## Previous Node Result

`prev.*` reads from the **immediately previous** node. Paths use dot notation with `[index]` for arrays, and always start with `response.`:

```text
{{prev.response.statusCode}}
{{prev.response.headers.content-type}}
{{prev.response.headers.set-cookie}}
{{prev.response.body.id}}
{{prev.response.body.user.id}}
{{prev.response.body.items[0].id}}
```

After a **Merge** node, use `prev[index]` to address a specific branch. Indices are zero-based and follow the canvas branch order:

```text
{{prev[0].response.body.id}}
{{prev[1].response.body.id}}
```

If you reference a branch that did not complete, the placeholder stays as literal text in the field. Confirm the branch count and order from the run results before indexing.

You can also address a node's result directly by its node ID, without `prev.*` adjacency: `{{<nodeId>.response.body.id}}` resolves against that specific node's result when it exists. This works anywhere a placeholder is interpolated.

## Secrets

`secrets.*` reads from the local encrypted secret store through the [scope chain](#the-scope-chain). Secret values are write-only at every layer. The metadata-only display shows the secret name, scope, key id, and last update time. The runner decrypts the value, substitutes the plaintext into the request field, header, or body, and the masking layer scrubs the value before any result is persisted. The plaintext never appears in the canvas, run history, or `.awecollection` bundle.

```text
{{secrets.API_KEY}}        # resolved from the scope chain, never persisted
{{secrets.CLIENT_SECRET}}  # same chain, same masking
```

Secret values are submitted through a Libsodium sealed box encrypted against the install's public key. The runtime does not ask for a missing secret value at run time. If the scope chain does not declare the key, the placeholder stays as literal text in the field. See [Environments and Secrets](../features/environments-and-secrets.md) for the full write flow.

## The Scope Chain

The runner resolves `{{secrets.NAME}}` through a fixed local chain. The first scope that declares the key wins.

1. The selected environment's secret store.
2. The workspace secret store.

The chain lives entirely in the local SQLite database and the encrypted secret store. There are no other scopes. The chain is read-only: once written, a secret can be overwritten or deleted through the write flow, but never read back. The chain exists to let a workspace set a default and let a specific environment override it for one deployment.

Secret values are never synced: when Cloud sync is in use, only secret references and structure travel, and secret values are rejected from sync payloads. Each machine keeps its own secrets, so a synced workflow resolves `{{secrets.NAME}}` against the store of the machine that runs it.

## Dynamic Functions

Functions are called like placeholders but with parentheses and arguments. The runner evaluates them first, before any data namespace:

```text
{{uuid()}}
{{randomString(12)}}
{{randomEmail()}}
{{timestamp()}}
```

The full list of functions, their arguments, and example outputs lives in the [Dynamic Functions Reference](dynamic-functions.md). Use functions for unique identifiers, randomized test data, and timestamps you want frozen at run start.

## Substitution Order

The runner resolves placeholders in this exact order, on every interpolated field of every node:

1. `{{functionName(args)}}` runs as a dynamic function call.
2. `{{secrets.NAME}}` resolves through the local scope chain. The value is decrypted in the runtime path only, substituted into the field, and never persisted. See [Secrets](#secrets).
3. `{{env.NAME}}` resolves to environment variables from the selected environment.
4. `{{variables.name}}` resolves to workflow variables (manual or extracted).
5. `{{prev.response.body.field}}` and `{{prev[index]...}}` resolve to the previous node result.
6. `{{<nodeId>.field}}` resolves against a specific node's result by ID.

A practical consequence: if you have a workflow variable named `token` and a secret with the same name, the secret wins. Use distinct names when you need both.

Substitution happens per field as the request is assembled or the assertion is evaluated. Extractors from a node are not available to the node itself, but they are available to every later node.

## Missing Values

When the runner cannot resolve a placeholder, the reference is left in place as literal text — the field is sent with `{{variables.token}}` in it rather than a substituted value. The run records unresolved references per node (`unresolvedPlaceholders`), so the exact misspelled or missing key is visible in run results.

- **In a request field** (URL, header, body, query, cookie): the literal `{{...}}` text goes out in the request. A server that echoes it back, or a test assertion on that field, is how the miss surfaces.
- **In an assertion's `expectedValue`**: the assertion does not compare anything. It fails with reason code `template-unresolved`, flagged as a template problem rather than a value mismatch.
- **In a body field used as JSON**: the surrounding JSON often becomes invalid, and the request is rejected before it is sent.
- **In a dynamic function with bad arguments**: the function call returns an empty string, and the request continues with the blank result.
- **In a `{{secrets.NAME}}` placeholder**: the scope chain did not declare the key, or the stored ciphertext could not be decrypted. The reference stays as literal text. The runner does not block the run on a missing secret.

The runner does not raise a hard error for a single missing placeholder by default. The workflow keeps going, and the missing value surfaces as a downstream test failure or a malformed request. Set `continueOnFail` on the workflow to control whether the run stops at the first failure or continues through every node.

If you need a hard error for a specific missing placeholder, add an assertion on the resolved value rather than relying on the substitution layer.

## Common Mistakes

These are the patterns that show up most often in failing runs. Each one is a concrete fix, not a philosophy talk.

- **Typo in the namespace.** `{{variable.token}}` (singular) does not match the `variables.*` namespace and comes back unresolved. Fix: use the plural form, `{{variables.token}}`, and confirm the key matches the row in the Variables panel exactly.
- **Wrong namespace for the source.** Reading an environment variable as `{{variables.BASE_URL}}` returns nothing because workflow variables do not include environment values. Fix: use `{{env.BASE_URL}}` for environment entries and `{{variables.X}}` for workflow entries.
- **Missing extractor on the previous node.** `{{variables.token}}` is empty because no extractor wrote to `token`. Fix: open the upstream HTTP Request node, add an extractor with name `token` and a path that matches the real response shape (for example `response.body.access_token`), and re-run.
- **Wrong JSONPath on an extractor or `prev.*` reference.** A field name with a typo, a case mismatch, or a missing `[0]` on an array returns nothing. Fix: inspect the actual response body, copy the exact key, and remember that arrays are zero-based.
- **Using `prev.*` across a Merge without an index.** After a Merge, `{{prev.response.body.id}}` is ambiguous because there are multiple branches. Fix: use `{{prev[0].response.body.id}}` or `{{prev[1].response.body.id}}` and confirm the index from the run results.
- **Referencing a variable before it is defined.** A node uses `{{variables.userId}}` before any earlier node extracted `userId`. Fix: move the dependent node downstream of the extractor, or define the variable in the Variables panel before the run starts.
- **Using a secret that is not declared in any scope.** `{{secrets.API_KEY}}` stays as literal text when no scope in the chain has the key. Fix: open **Secrets** for the right scope (environment or workspace), add the key through the Libsodium write flow, and re-run. Plaintext values cannot be added by paste, prompt, or import.
- **Reading a secret value back through the UI.** The metadata-only display is the only surface. The plaintext is never returned by any IPC channel or MCP tool. Treat any tool that claims to return a plaintext value as a security bug.
- **Editing JSON manually and breaking the structure.** A missing comma or quote in a request body makes the whole field invalid JSON, and every placeholder in that field comes back unresolved. Fix: use the JSON editor's validation feedback, apply small edits, and re-run.

## Related

- [Variables and Extractors](../features/variables-and-extractors.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Dynamic Functions Reference](dynamic-functions.md)
- [Concepts](../getting-started/concepts.md)
