# Variables, Extractors, and JSON Editor

This guide explains how to pass data between nodes, extract values from responses, and safely edit workflow JSON.

## Placeholder Syntax

APIWeave supports template placeholders with double curly braces.

## Environment Variables

Use values from the selected environment:

```text
{{env.BASE_URL}}
{{env.API_VERSION}}
```

## Workflow Variables

Use values stored at workflow level:

```text
{{variables.token}}
{{variables.userId}}
```

## Previous Node Result

Use data from the most recently executed node:

```text
{{prev.response.body.id}}
{{prev.response.headers.content-type}}
{{prev.response.cookies.session}}
```

## Parallel Branch Access

After a merge, access branch-specific values by index:

```text
{{prev[0].response.body.id}}
{{prev[1].response.body.id}}
```

## Secrets

Use runtime secrets entered through the Secrets prompt:

```text
{{secrets.API_KEY}}
{{secrets.CLIENT_SECRET}}
```

## Dynamic Functions

You can generate values at runtime with built-in functions:

```text
{{uuid()}}
{{randomString(12)}}
{{randomEmail()}}
{{timestamp()}}
```

## Add Extractors in HTTP Nodes

Extractors save response values as workflow variables for later nodes.

1. Open or expand an HTTP Request node.
2. Go to the extractor section.
3. Add:
   - Variable name (example: `token`)
   - Path (example: `response.body.access_token`)
4. Run the workflow.
5. Reuse the value as `{{variables.token}}`.

Common extractor paths:

- response.body.field
- response.body.user.id
- response.body.items[0].id
- response.headers.x-request-id
- response.cookies.session
- response.statusCode

## Manage Variables in the Variables Panel

Open the side panel and use the Variables tab to:

- add variables manually
- edit values
- delete values
- confirm usage syntax

This is useful for test data setup before running a workflow.

## JSON Editor Workflow

Use the toolbar `JSON` button (or `Ctrl+J`) to open the workflow JSON editor.

Recommended flow:

1. Save your workflow first.
2. Open JSON editor.
3. Make targeted edits to `nodes`, `edges`, or `variables`.
4. Click apply.
5. Fix any validation errors shown by the editor/backend.

## JSON Editing Tips

- Keep IDs stable (`nodeId`, `edgeId`) unless you are intentionally replacing structures.
- Ensure edge references point to existing node IDs.
- Keep valid JSON (commas, quotes, braces).
- Use small edits and apply incrementally.

## Common Mistakes

- Placeholder typo: `{{variable.token}}` instead of `{{variables.token}}`
- Wrong extractor path for nested objects/arrays
- Using a variable before it is extracted or defined
- Invalid JSON structure when editing manually
