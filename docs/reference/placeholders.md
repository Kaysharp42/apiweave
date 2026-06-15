# Placeholders

*Canonical reference for the five placeholder namespaces in APIWeave. Use this doc when you need the exact syntax for a placeholder, the order the runner resolves them in, or what happens when a value is missing.*

## Prerequisites

None. This is a reference doc. Read [Concepts](../getting-started/concepts.md) first if you are new to variables, extractors, environments, or secrets.

## Table of Contents

- [Overview](#overview)
- [Namespaces](#namespaces)
- [Environment Variables](#environment-variables)
- [Workflow Variables](#workflow-variables)
- [Previous Node Result](#previous-node-result)
- [Secrets](#secrets)
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

The segment before the first dot is the **namespace**. The segment after the dot is the **key** (or, for `prev.*`, a JSONPath into the previous node's response object). There are five namespaces, plus one helper syntax for dynamic functions.

All placeholders work in any request field: URL, method, query parameters, headers, cookies, body, timeout, and assertion paths.

## Namespaces

| Namespace     | Example                              | Source                                                       | Resolved at run time?           |
| ------------- | ------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| `env.*`       | `{{env.BASE_URL}}`                   | Active environment                                           | Yes                             |
| `variables.*` | `{{variables.token}}`                | Workflow variable (manual or extracted)                      | Yes                             |
| `prev.*`      | `{{prev.response.body.id}}`          | Previous node result (`prev[0]` after a merge)              | Yes                             |
| `secrets.*`   | `{{secrets.API_KEY}}`                | Runtime-entered value (encrypted at rest)                    | Yes                             |
| functions     | `{{uuid()}}`                         | Dynamic helper (uuid, timestamp, randomString, etc.)        | Yes                             |

The four data namespaces are tried in a fixed order. See [Substitution Order](#substitution-order) for the exact sequence.

## Environment Variables

`env.*` reads from the **active** environment. Switching the environment is how the same workflow targets staging, production, or a local server without editing the canvas.

```text
{{env.BASE_URL}}
{{env.API_VERSION}}
{{env.TIMEOUT_SECONDS}}
```

Build URLs by combining an env variable with a literal path:

```text
{{env.BASE_URL}}/users/{{variables.userId}}
```

Environment values are plain text. Do not put secrets there; use the `secrets.*` namespace instead. See [Environments and Secrets](../features/environments-and-secrets.md) for how to declare and activate environments.

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
{{prev.response.cookies.session}}
{{prev.response.body.id}}
{{prev.response.body.user.id}}
{{prev.response.body.items[0].id}}
```

After a **Merge** node, use `prev[index]` to address a specific branch. Indices are zero-based and follow the canvas branch order:

```text
{{prev[0].response.body.id}}
{{prev[1].response.body.id}}
```

If you reference a branch that did not complete, the placeholder resolves to an empty value. Confirm the branch count and order from the run results before indexing.

## Secrets

`secrets.*` reads from the active environment's secret store. Values are encrypted at rest with the hybrid envelope described in the [Encryption Guide](../operations/encryption.md) and resolved at run time without exposing the plaintext in the canvas or in exported workflows.

```text
{{secrets.API_KEY}}        # declared in env, encrypted at rest, resolved at run time
{{secrets.CLIENT_SECRET}}  # declared in env, encrypted at rest, resolved at run time
```

The runtime prompt that asks for a missing secret value is not part of the flow. Declare the key and its value in the Environment Manager, and the runner will resolve it on every run. Never paste a real secret into a workflow definition, a comment, a commit, or a `.awecollection` export.

## Dynamic Functions

Functions are called like placeholders but with parentheses and arguments. The runner evaluates them after the data namespaces:

```text
{{uuid()}}
{{randomString(12)}}
{{randomEmail()}}
{{timestamp()}}
{{timestamp(1735000000)}}
```

The full list of functions, their arguments, and example outputs lives in the [Dynamic Functions Reference](dynamic-functions.md). Use functions for unique identifiers, randomized test data, and timestamps you want frozen at run start.

## Substitution Order

The runner resolves placeholders in this exact order, on every field of every node:

1. `{{variables.name}}` resolves to workflow variables (manual or extracted).
2. `{{env.NAME}}` resolves to environment variables from the active environment.
3. `{{prev.response.body.field}}` and `{{prev[index]...}}` resolve to the previous node result.
4. `{{secrets.NAME}}` resolves to a secret declared on the active environment. The value is decrypted in the runtime path only and never persisted to logs or exports. See [Secrets](#secrets).
5. `{{functionName(args)}}` runs as a dynamic function call.

A practical consequence: if you have a workflow variable named `token` and a secret with the same name, the workflow variable wins. Use distinct names when you need both.

Resolution happens once per node, before the node executes. Extractors from that node are not available to the same node, but they are available to every later node.

## Missing Values

When the runner cannot resolve a placeholder, the behavior depends on where the placeholder appears:

- **In a request field** (URL, header, body, query, cookie, timeout): the placeholder is replaced with an empty string. The request still goes out, but with a blank or malformed value. A blank URL is a common symptom.
- **In an assertion**: the assertion evaluates against an empty value and fails. The exact operator determines the failure message (for example, "expected non-empty string").
- **In a body field used as JSON**: the surrounding JSON often becomes invalid, and the request is rejected before it is sent.
- **In a dynamic function with bad arguments**: the function call returns an empty string, and the request continues with the blank result.

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
- **Using a secret that is not declared on the active environment.** `{{secrets.API_KEY}}` resolves to an empty string when the active environment has no key by that name. Fix: open the Environment Manager, add the key, and re-run. The decrypted value never appears in the canvas, run history, or exported workflows.
- **Editing JSON manually and breaking the structure.** A missing comma or quote in a request body makes the whole field invalid JSON, and every placeholder in that field comes back unresolved. Fix: use the JSON editor's validation feedback, apply small edits, and re-run.

## Related

- [Variables and Extractors](../features/variables-and-extractors.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Dynamic Functions Reference](dynamic-functions.md)
- [Encryption Guide](../operations/encryption.md)
- [Concepts](../getting-started/concepts.md)
