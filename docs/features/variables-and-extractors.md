# Variables and Extractors

*How to pass data between steps in a workflow: the four placeholder namespaces, how to extract values from responses, and how to manage workflow-level variables.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the basic variable and extractor definitions.
- [Workflows and Nodes](workflows-and-nodes.md) for the HTTP Request node where extractors live.
- [Placeholders Reference](../reference/placeholders.md) for the full placeholder grammar, resolution order, and edge cases.

## Placeholder Syntax

Every placeholder uses double curly braces. APIWeave resolves them before the request, assertion, or body field is sent:

```text
{{namespace.name}}
```

Four namespaces are available. They are tried in a fixed order, see the [Placeholders Reference](../reference/placeholders.md) for the exact rules.

| Namespace     | Source                                  | Typical use                                          |
| ------------- | --------------------------------------- | ---------------------------------------------------- |
| `variables.*` | Workflow variable (manual or extracted) | Token returned by a previous step                    |
| `env.*`       | Active environment                      | Base URL, API version                                |
| `prev.*`      | Previous node result                    | Read a field from the upstream response              |
| `secrets.*`   | Runtime secret prompt                   | API key, client secret (encrypted at rest)            |

Dynamic functions such as `{{uuid()}}` and `{{timestamp()}}` are also available; see [Dynamic Functions Reference](../reference/dynamic-functions.md).

## Environment Variables

Environment variables come from the active environment, so the same workflow can target staging or production without editing the canvas.

```text
{{env.BASE_URL}}
{{env.API_VERSION}}
```

Combine them with literal path segments to build a full URL:

```text
{{env.BASE_URL}}/users/{{variables.userId}}
```

Environment values are plain text. Do not put secrets there; use the `secrets.*` namespace instead.

## Workflow Variables

Workflow variables are values that belong to a single workflow. You create them in the Variables panel or by extracting them from a response. They are available in any later node on the same run.

```text
{{variables.token}}
{{variables.userId}}
{{variables.cartId}}
```

Workflow variables persist for the duration of the run and are visible in the Variables panel after each completed node.

## Previous Node Result

`prev.*` reads from the immediately previous node. After a Merge node, use `prev[index]` to address a specific branch by its index.

```text
{{prev.response.body.id}}
{{prev.response.headers.content-type}}
{{prev.response.cookies.session}}
{{prev.response.statusCode}}
```

For parallel branches, the index starts at 0 and matches the branch order on the canvas:

```text
{{prev[0].response.body.id}}
{{prev[1].response.body.id}}
```

## Secrets

Secrets are declared as named keys on an environment and encrypted at rest. The runner resolves `{{secrets.NAME}}` against the active environment and substitutes the plaintext value into the request field, header, body, or assertion path. The plaintext never appears in the canvas or in exported workflows. The at-rest model, rotation, and the threat surface are covered in the [Encryption Guide](../operations/encryption.md).

```text
{{secrets.API_KEY}}        # declared in env, encrypted at rest, resolved at run time
{{secrets.CLIENT_SECRET}}  # declared in env, encrypted at rest, resolved at run time
```

## Adding Extractors in an HTTP Request

An extractor pulls a value out of an HTTP response and stores it as a workflow variable. After the node runs, the value is reachable as `{{variables.name}}` in any later node.

Step by step:

1. Open or add an HTTP Request node on the canvas.
2. Double-click the node to open the full editor, or use the inline extractor section in the node body.
3. Scroll to the **Extractors** section and click **Add extractor**.
4. Enter a variable name (for example `token`).
5. Enter the JSONPath that points at the value to capture (for example `response.body.access_token`).
6. Save the node. Auto-save persists the change to the workflow.
7. Run the workflow. The value appears in the Variables panel and is available to downstream nodes as `{{variables.token}}`.

A typical login-then-call flow looks like this:

```text
HTTP Request: POST /login  ->  200 OK { "access_token": "abc123" }

Extractor:
  name = token
  path = response.body.access_token

Later node:
  Authorization: Bearer {{variables.token}}
```

You can add more than one extractor per node. Each extractor writes to its own workflow variable name.

## JSONPath Examples

Paths are written in dot notation with `[index]` for arrays. They start with `response.` because every extractor reads from a node's response object.

```text
response.statusCode                 # integer status code
response.headers.content-type       # response header
response.cookies.session            # response cookie
response.body.id                    # top-level field
response.body.user.id               # nested object
response.body.items[0].id           # first element of an array
response.body.items[0].name         # field on the first array element
response.body.data[2].tokens[0]     # nested array indexing
response.body.errors[0].message     # first error message
response.headers.x-request-id       # custom header
```

For a full grammar, see the [Placeholders Reference](../reference/placeholders.md).

## Managing Variables

Open the side panel and switch to the **Variables** tab to work with workflow variables directly.

- **Add**: click **Add variable**, enter a name and a value, save. The value is available as `{{variables.name}}` in any node.
- **Edit**: click a variable row, change the value, save. The new value is used on the next run; in-flight runs keep the value they captured.
- **Delete**: click the trash icon on the row. Any later node that still references the deleted variable will fail until the reference is updated.
- **Inspect**: after a run, the panel shows the resolved value of every variable, including those created by extractors. Use it to confirm an extractor wrote what you expected.

The Variables panel is also where to confirm the exact placeholder syntax for a variable. The `name` field in the panel is the segment after the dot, so a row named `token` is used as `{{variables.token}}`.

## Troubleshooting

- **If a placeholder comes back as plain text in the request or response**, the namespace is misspelled or the key does not exist. The most common typo is `{{variable.token}}` (singular) instead of `{{variables.token}}` (plural). Open the Variables panel or the environment editor and confirm the key exists with the exact name.
- **If an extractor did not set a value**, the JSONPath does not match the real response shape. Inspect the node's response body for the actual field name (including case) and update the path. Arrays use zero-based indices, so `response.body.items[0].id` reads the first element only.
- **If a `prev.*` reference is empty after a Merge node**, the index does not match a branch. Branch indices start at 0 and follow the canvas order. Check the run results to confirm how many branches completed and which index each one received.
- **If `{{secrets.NAME}}` is not resolved at run time**, the key is not declared on the active environment, or the stored ciphertext cannot be decrypted. Open the Environment Manager, confirm the key exists on the active environment, and verify `SECRET_ENCRYPTION_KEY` is set in the backend environment. The full diagnostic path is in the [Encryption Guide](../operations/encryption.md).

## Related

- [Concepts](../getting-started/concepts.md)
- [Workflows and Nodes](workflows-and-nodes.md)
- [Environments and Secrets](environments-and-secrets.md)
- [Placeholders Reference](../reference/placeholders.md)
- [Dynamic Functions Reference](../reference/dynamic-functions.md)
