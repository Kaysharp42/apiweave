/**
 * The MCP documentation surface: the conventions an agent has to know to author
 * a working APIWeave workflow, served as readable resources.
 *
 * These exist because `tools/list` alone is not enough. A JSON schema says
 * `path` is a string; it cannot say that a `prev` path must address the response
 * object, or that an assertion's outgoing edges are handle-routed, or that
 * `{{variables.x}}` is plural. Field-level `.describe()` annotations (see
 * `WorkflowEdgeSchema`, `AssertionItemSchema`, `HTTPNodeDataSchema`) carry the
 * short form; these guides carry the worked examples and the order of
 * operations, which do not fit in a schema.
 *
 * The text lives here rather than in `docs/`, which is not packaged: only
 * `dist/desktop/**` ships (see `app/package.json` `build.files`), so a guide
 * read from the repo tree would 404 in an installed app. `docs/` remains the
 * human-facing copy; this is the agent-facing copy, deliberately shorter.
 */

export interface McpGuide {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly text: string
}

export const GUIDE_URI_PREFIX = "apiweave://guide/"

export function guideUri(slug: string): string {
  return `${GUIDE_URI_PREFIX}${slug}`
}

const START_HERE = `# Building a workflow with APIWeave

An APIWeave workflow is a directed graph of nodes. A run starts at the \`start\`
node and follows edges. Nothing runs unless an edge leads to it.

## Order of operations that avoids wasted runs

1. **Look for an existing workflow first.** \`workflows_list\` then
   \`workflows_get\` on anything similar in the workspace. A real workflow shows
   you the conventions this workspace already uses — base URLs, auth headers,
   variable names — faster than any documentation. Credential values are
   withheld, the structure is not.
2. **Read \`apiweave://guide/workflow-authoring\`** for the node and edge shapes,
   and \`apiweave://guide/placeholders\` for the interpolation syntax.
3. **Build ONE branch end to end**, not three in parallel. A syntax mistake made
   once is one diagnostic; made three times it is nine, and the report gets hard
   to read. Get one chain clean, then copy it.
4. **Read the \`diagnosis\` in the write response.** \`workflows_create\`,
   \`workflows_update\` and \`workflows_patch\` each return a static diagnosis
   alongside the workflow. Fix every \`error\` before going further — see
   \`apiweave://guide/diagnostics\`.
5. **Fix with \`workflows_patch\`, not \`workflows_update\`.** Patch changes nodes
   and edges by id; update replaces the whole graph and makes you re-send every
   node to change one field.
6. **Only then \`runs_create\`.** A run sends real HTTP requests to a real
   service. Everything above is free; a run is not.
7. **After a successful run, use \`assertion_suggest\`.** It reads a response
   that actually happened and returns rules with verified paths. That is a
   better starting point for assertions than writing them by hand — and the
   canonical way to get a path right on the first try.

## Minimal working graph

\`\`\`json
{
  "name": "Fetch a pet",
  "nodes": [
    { "nodeId": "start", "type": "start" },
    {
      "nodeId": "get_pet",
      "type": "http-request",
      "config": {
        "method": "GET",
        "url": "{{env.BASE_URL}}/pets/{{variables.petId}}",
        "headers": [{ "key": "Accept", "value": "application/json" }],
        "extractors": { "petName": "response.body.name" }
      }
    },
    {
      "nodeId": "check",
      "type": "assertion",
      "config": {
        "assertions": [
          { "source": "status", "path": "", "operator": "equals", "expectedValue": 200 },
          { "source": "prev", "path": "response.body.id", "operator": "exists" }
        ]
      }
    },
    { "nodeId": "done", "type": "end" }
  ],
  "edges": [
    { "edgeId": "e1", "source": "start", "target": "get_pet" },
    { "edgeId": "e2", "source": "get_pet", "target": "check" },
    { "edgeId": "e3", "source": "check", "target": "done", "sourceHandle": "pass" }
  ],
  "variables": { "petId": "1" }
}
\`\`\`

Three things to copy from this:

- Edges leaving \`check\` carry \`sourceHandle\`. Without it the branch stops silently.
- The \`prev\` path is \`response.body.id\`, not \`id\`.
- There is **exactly one \`start\` and exactly one \`end\`**. Branches converge on
  the same \`end\` rather than each getting their own — a second \`end\` node is
  reported as \`duplicate_end_node\`.

This graph leaves \`check\`'s \`fail\` handle unwired — the normal, expected shape:
the run still records the failed assertion and terminates that branch. Wire
\`fail\` only when you want a distinct failure path (a cleanup request, a
notification, a compensating call), by adding a node and edges with
\`"sourceHandle": "fail"\`:

\`\`\`json
{ "nodeId": "report_failure", "type": "http-request", "config": { "method": "POST", "url": "{{env.BASE_URL}}/report" } }
\`\`\`

\`\`\`json
{ "edgeId": "e4", "source": "check", "target": "report_failure", "sourceHandle": "fail" },
{ "edgeId": "e5", "source": "report_failure", "target": "done" }
\`\`\`

## Related

- \`apiweave://guide/workflow-authoring\` — node types and their config shapes
- \`apiweave://guide/placeholders\` — \`{{env.x}}\`, \`{{variables.x}}\`, \`{{prev.x}}\`, \`{{secrets.x}}\`
- \`apiweave://guide/assertions\` — assertion rules and the authoring flow
- \`apiweave://guide/diagnostics\` — what each diagnostic code means
- \`apiweave://guide/redaction\` — what reads withhold, and why you must not write it back
`

const WORKFLOW_AUTHORING = `# Nodes and edges

## Node types

Every node is \`{ nodeId, type, config?, label?, position? }\`. \`position\` is
canvas layout only — execution order comes from the edges, never from position
or array order.

| type | what it does | handles |
| --- | --- | --- |
| \`start\` | entry point; the run begins here | output only, exactly one per workflow |
| \`end\` | terminal point | input only, **exactly one** — converge branches on it |
| \`http-request\` | sends one request, optionally extracts variables | 1 in, 1 out |
| \`assertion\` | checks the upstream response and branches | 1 in, **2 out: \`pass\` and \`fail\`** |
| \`delay\` | waits a fixed number of milliseconds | 1 in, 1 out |
| \`merge\` | joins parallel branches | many in, 1 out |
| \`workflow\` | runs another workflow in this workspace inline | 1 in, 1 out |

### http-request

\`\`\`json
{
  "nodeId": "login",
  "type": "http-request",
  "config": {
    "method": "POST",
    "url": "{{env.BASE_URL}}/login",
    "headers": [{ "key": "Content-Type", "value": "application/json" }],
    "body": "{\\"user\\": \\"{{env.USER}}\\", \\"pass\\": \\"{{secrets.PASSWORD}}\\"}",
    "bodyType": "json",
    "extractors": { "token": "response.body.access_token" }
  }
}
\`\`\`

- \`headers\`, \`queryParams\`, \`cookies\` are **arrays of \`{key, value}\`**, not maps.
- \`body\` is a **string**, not an object. A JSON body is its serialized text.
- \`extractors\` is a map of variable name to response path. After this node runs,
  later nodes read \`{{variables.token}}\`. Paths start at the response object:
  \`response.body.*\`, \`response.headers.*\`, \`response.statusCode\`.
- \`continueOnFail: true\` lets the run continue past a failed request.
- \`expectedStatus\` — the status code(s) this request is expected to return (a number
  or an array of numbers, 100-599). The node passes when the response matches and
  **fails when it does not, including when it returns 2xx**. Omit for the default,
  where any 2xx passes. Use this for negative tests: a request that is supposed to
  be rejected, e.g. \`"expectedStatus": 409\` for a state-transition guard. It is
  orthogonal to \`continueOnFail\`: \`expectedStatus\` decides whether the node
  failed, \`continueOnFail\` decides whether a failure stops the branch.

### assertion

An assertion node checks values from **the nearest \`http-request\` node
upstream** — in a chain of several, that is the closest one, not the first.
Zero \`http-request\` nodes upstream, or two at the same distance, makes the
source ambiguous and the node fails — \`workflow_diagnose\` reports this as
\`assertion_source_missing\` or \`assertion_source_ambiguous\` before you ever run it.

Rules live at \`config.assertions\`. See \`apiweave://guide/assertions\`.

\`pass\` and \`fail\` are the two output handles. Both are optional wires: an
unwired \`fail\` handle is the normal, expected shape — the run records the
failed assertion and terminates that branch. Wire \`fail\` only when you want a
distinct failure path (a cleanup request, a notification, a compensating call).
Wiring every \`fail\` handle straight to the shared \`end\` node does exactly what
leaving it unconnected already does, just with more edges — \`workflow_diagnose\`
flags that shape as \`assertion_fail_wired_on_all\` (notice, not warning: it is
verbose, not wrong).

Both handles also fan out in parallel: more than one edge leaving \`pass\` (or
\`fail\`) starts all the target branches concurrently — \`workflow_diagnose\` notes
this as \`assertion_branch_duplicate\` (a notice, not a warning; it is verbose,
not wrong). To rejoin parallel branches downstream, route them into a single
\`merge\` node.

### merge

\`config.mergeStrategy\` is \`all\` (wait for every branch), \`any\` (first to finish),
\`first\` (first to start), or \`conditional\`. Downstream of a merge, address a
specific branch by index: \`{{prev[0].response.body.id}}\`.

### workflow (call another workflow)

\`\`\`json
{
  "nodeId": "authenticate",
  "type": "workflow",
  "config": {
    "targetWorkflowId": "wf_login",
    "inputMapping": { "tenant": "{{variables.tenantId}}" },
    "outputMapping": { "authToken": "accessToken" }
  }
}
\`\`\`

Runs inline inside the current run — no separate run history entry. The
sub-workflow shares the environment and secrets, so only \`variables\` need
mapping. \`inputMapping\` maps a target variable name to an expression resolved in
the **caller's** context; \`outputMapping\` maps a caller variable name to a
sub-workflow variable name. A \`{{secrets.NAME}}\` on the right-hand side of an
input mapping is rejected — let the sub-workflow read the secret itself. The
target must live in the same workspace and cannot be the calling workflow.
Recursion is capped at 8 levels.

## Edges

\`\`\`json
{ "edgeId": "e3", "source": "check", "target": "ok", "sourceHandle": "pass" }
\`\`\`

**Every edge leaving an \`assertion\` node must set \`sourceHandle\` to exactly
\`"pass"\` or \`"fail"\`.** The assertion routes its result down the matching
branch; an edge without a handle is never followed, so the branch stops silently
mid-run. This is the single most common authoring mistake, and
\`workflow_diagnose\` reports it as \`assertion_branch_handle_invalid\` — an error
you can see before running anything.

That rule constrains which handle an edge that *exists* must use — it does not
require an edge on *every* handle. Leaving \`fail\` unconnected is normal: the run
still records the failed assertion and stops that branch there.

Nodes of every other type have one output; leave \`sourceHandle\` unset for them.

## Changing a graph

\`workflows_update\` replaces \`nodes\`, \`edges\` and \`variables\` wholesale — a
field you omit is not "unchanged", the whole list is overwritten by what you
send. To change part of a graph, use \`workflows_patch\`, which upserts and
removes by id:

\`\`\`json
{
  "workspaceId": "...",
  "workflowId": "...",
  "expectedRevision": 7,
  "upsertEdges": [
    { "edgeId": "e3", "source": "check", "target": "ok", "sourceHandle": "pass" }
  ]
}
\`\`\`

\`expectedRevision\` (the workflow's current \`rev\`) makes the write a
compare-and-swap: if someone edited the workflow meanwhile you get a conflict
instead of silently clobbering their change. Removing a node also removes the
edges attached to it.
`

const PLACEHOLDERS = `# Placeholders

Every string field in a request — URL, method, query params, headers, cookies,
body, timeout — is interpolated before the request goes out. The syntax is
always \`{{namespace.name}}\`.

| namespace | example | source |
| --- | --- | --- |
| \`env.*\` | \`{{env.BASE_URL}}\` | the environment selected for the run |
| \`variables.*\` | \`{{variables.token}}\` | workflow variable: seeded manually or written by an extractor |
| \`prev.*\` | \`{{prev.response.body.id}}\` | the previous node's result |
| \`secrets.*\` | \`{{secrets.API_KEY}}\` | the local secret scope chain (environment, then workspace) |
| functions | \`{{uuid()}}\` | dynamic helpers: \`uuid()\`, \`timestamp()\`, \`randomString(n)\`, … |

## variables (note the plural)

\`{{variables.token}}\`, never \`{{variable.token}}\` — the singular form is not a
namespace and is left in the request as literal text. A variable comes from
either the workflow's \`variables\` map or an upstream node's \`extractors\`:

\`\`\`json
"extractors": { "token": "response.body.access_token" }
\`\`\`

then downstream: \`{ "key": "Authorization", "value": "Bearer {{variables.token}}" }\`.

\`workflow_diagnose\` reports a \`{{variables.x}}\` with no producer as
\`variable_source_missing\`, and a producer that is not actually upstream of its
consumer as \`variable_producer_not_upstream\`.

## prev

\`prev\` addresses the previous node's result object. Paths use dot notation with
\`[n]\` for array indexes:

\`\`\`text
{{prev.response.body.id}}
{{prev.response.body.items[0].name}}
{{prev.response.headers.content-type}}
{{prev.response.statusCode}}
\`\`\`

After a \`merge\` node, index the branch: \`{{prev[0].response.body.id}}\`.
Branch indexes start at 0 in canvas order.

## secrets

\`{{secrets.NAME}}\` resolves from the environment first, then the workspace
store. The value must already exist in a scope before the run — there is no
runtime prompt, and secrets cannot be created over MCP (\`secrets_list\` and
\`secrets_resolve\` are metadata-only). Use \`secrets_list\` to see which names
are available.

Never inline a real credential into a workflow. Write \`{{secrets.API_KEY}}\` and
the reference survives reads, exports and sync intact; a literal does not.

## When a placeholder does not resolve

It is left in the request as literal text rather than failing. If a request goes
out with \`{{env.BASE_URL}}\` in the URL, the environment is not selected or the
key does not exist — check \`workflows_get\` for \`selectedEnvironmentId\` and
\`environments_get\` for the key.

Every run-relevant node result carries an \`unresolvedPlaceholders\` list naming
the references that stayed literal (e.g. \`["env.EMAIL", "variables.token"]\`);
\`runs_get\` and \`runs_getNodeResult\` surface it per node. A failed run whose
node lists placeholders means the request went out with literal text — fix the
missing value, not the target. A 401 from an auth endpoint with
\`unresolvedPlaceholders\` present is a misconfiguration, not bad credentials.
`

const ASSERTIONS = `# Assertions

A rule is \`{ source, path, operator, expectedValue? }\`. Rules live at
\`config.assertions\` on an \`assertion\` node, and every rule must pass for the
node to take its \`pass\` branch.

## source decides what path means

| source | what it reads | path |
| --- | --- | --- |
| \`status\` | the response status code | **must be \`""\`** |
| \`prev\` | the upstream response object | \`response.body.<field>\`, \`response.headers.<name>\`, \`response.statusCode\`, \`response.duration\` |
| \`headers\` | one response header | the header name, e.g. \`content-type\` |
| \`cookies\` | one response cookie | the cookie name, e.g. \`session\` |
| \`variables\` | one workflow variable | the variable name, e.g. \`token\` |

A **bare field name is not a path**. \`{"source": "prev", "path": "id"}\` does not
address anything; the value lives at \`response.body.id\`. \`assertion_validate\`
canonicalizes a path that is merely missing its prefix (\`body.id\` becomes
\`response.body.id\`) and rejects anything that cannot address a value, with a
message naming the accepted shapes.

For \`headers\`, \`cookies\` and \`variables\` the path is just the name — no
\`response.\` prefix.

## operators

\`equals\`, \`notEquals\`, \`contains\`, \`notContains\`, \`gt\`, \`gte\`, \`lt\`,
\`lte\`, \`count\`, \`exists\`, \`notExists\`.

- \`exists\` and \`notExists\` take no \`expectedValue\`; every other operator
  requires one.
- \`count\` compares the length of an array or string and needs a non-negative
  integer.
- \`status\` accepts only \`equals\`, \`notEquals\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`.

## Worked examples

\`\`\`json
{ "source": "status", "path": "", "operator": "equals", "expectedValue": 200 }
{ "source": "prev", "path": "response.body.id", "operator": "exists" }
{ "source": "prev", "path": "response.body.items", "operator": "count", "expectedValue": 3 }
{ "source": "prev", "path": "response.duration", "operator": "lte", "expectedValue": 500 }
{ "source": "headers", "path": "content-type", "operator": "contains", "expectedValue": "application/json" }
{ "source": "variables", "path": "token", "operator": "exists" }
\`\`\`

## Authoring flow

1. \`assertion_suggest\` with a \`runId\` and the source HTTP \`sourceNodeId\`.
   It reads a response that actually happened and returns rules whose paths are
   already verified against it. Use this whenever a run exists — it is faster and
   more reliable than writing paths by hand. It needs a completed result for that
   node; before any run exists, write rules from the table above instead.
2. \`assertion_validate\` with the rules. Read the returned \`preview\` and
   \`issues\`. The returned \`rules\` are canonicalized — pass those on, not your
   originals. \`valid: false\` means at least one error-severity issue.
3. \`assertion_apply\` with \`assertionNodeId\`, \`mode\` (\`"append"\` or
   \`"replace"\`), the validated rules, and \`expectedRevision\` taken from the
   workflow's \`rev\`. A conflict means the workflow changed underneath you:
   re-read, re-validate, retry.

\`assertion_apply\` targets an existing assertion node — it does not create one.
Add the node with \`workflows_create\`/\`workflows_patch\` first, remembering the
\`pass\`/\`fail\` edges.

## Never inline a credential

A secret-looking \`expectedValue\` is rejected with \`unsafe_literal\`. Compare
against \`{{secrets.NAME}}\` instead.
`

const DIAGNOSTICS = `# Diagnostics

\`workflow_diagnose\` statically analyses a stored graph and, given a \`runId\`,
correlates a past run. It sends no HTTP and changes nothing, so run it freely.
The write tools (\`workflows_create\`, \`workflows_update\`, \`workflows_patch\`)
return the same report as \`diagnosis\` in their own response — read it there
first.

Each diagnostic carries \`code\`, \`severity\` (\`error\` | \`warning\` | \`notice\`),
\`category\`, \`nodeIds\`, \`message\`, \`evidence\` and a \`remediation\` hint.
Clear every \`error\` before running.

## Topology

| code | meaning |
| --- | --- |
| \`missing_start_node\` / \`duplicate_start_node\` | a workflow needs exactly one \`start\` |
| \`missing_end_node\` / \`duplicate_end_node\` | a workflow needs exactly one \`end\`; converge branches on it rather than adding a second |
| \`duplicate_node_id\` / \`duplicate_edge_id\` | ids must be unique |
| \`dangling_edge\` | an edge references a nodeId that does not exist |
| \`unreachable_nodes\` | no path from \`start\` reaches these — they never run |
| \`cycle_detected\` | the graph loops |

## Assertions and branching

| code | meaning |
| --- | --- |
| \`assertion_branch_handle_invalid\` | an edge leaving an assertion has no \`sourceHandle\`, or one that is not \`pass\`/\`fail\`. The branch stops silently at run time. |
| \`assertion_branch_duplicate\` | more than one edge leaves one assertion handle — the branches run in parallel (notice, not warning) |
| \`assertion_fail_wired_on_all\` | a \`fail\` handle is wired straight to \`end\`, which does what leaving it unconnected already does — an unwired \`fail\` is the normal expected shape (notice) |
| \`assertion_source_missing\` / \`assertion_source_ambiguous\` | zero, or more than one, \`http-request\` node reachable upstream |
| \`assertion_source_path_invalid\` | the path cannot address a value for that source — see \`apiweave://guide/assertions\` |
| \`assertion_source_unknown\` / \`assertion_operator_unknown\` | not a member of the enum |
| \`assertion_expected_missing\` | the operator needs an \`expectedValue\` (present, not truthy; \`false\`, \`0\` and \`""\` are valid) |
| \`assertion_rules_missing\` | the node has no rules and always passes |
| \`continue_on_fail_status_check_migratable\` | a \`continueOnFail\` request with a downstream assertion pinning a non-2xx status — \`expectedStatus\` says the same thing and lets the run go green (notice) |

## Dataflow

| code | meaning |
| --- | --- |
| \`extractor_path_invalid\` | an extractor path does not start at the response object |
| \`variable_source_missing\` | \`{{variables.x}}\` is read but nothing produces it |
| \`variable_producer_duplicate\` | two nodes write the same variable |
| \`variable_producer_not_upstream\` | the producer is not upstream of the consumer, so the value is not set yet |

## Run-correlated (pass a \`runId\`)

| code | meaning |
| --- | --- |
| \`http_request_failed\` | a request returned >= 400 or failed in transport; \`evidence.blockedNodeIds\` lists what it stopped |
| \`assertion_failed\` | a rule compared false |
| \`assertion_source_mismatch\` | the run resolved a different source node than static analysis expects |
| \`extractor_path_missing\` / \`extractor_type_mismatch\` | the path did not match the real response shape |
| \`extractor_producer_not_executed\` | the producing node never ran |
| \`response_body_truncated\` / \`response_body_unavailable\` | the body was not fully captured, so path checks are inconclusive |
| \`secret_reference_unresolved\` | \`{{secrets.NAME}}\` had no value in any scope |
| \`nodes_not_executed\` | nodes the run never reached |

## Not covered

\`workflow\` (call-workflow) node targets are validated on save, not by the
analyzer. \`{{env.*}}\` references are not checked against the selected
environment. Both still fail at run time if wrong.
`

const REDACTION = `# What MCP reads withhold

Every read crossing this bridge is redacted. The rule: **an agent may see the
shape of anything, and the value of nothing that could be a credential.**

## Workflow and preset reads

Structure is preserved. A header whose name suggests a credential comes back as
an entry with its value replaced:

\`\`\`json
{ "key": "Authorization", "value": "<SECRET>" }
\`\`\`

The entry is still there, so you can tell "stored, value withheld" from "never
saved". Request bodies are redacted leaf by leaf: a plain JSON body comes back
as written, and only the fields that name or look like credentials are replaced.
Cookie values are always withheld. URLs keep their shape, losing only embedded
userinfo, a fragment, and secret-named query parameters.

\`{{secrets.NAME}}\` references survive verbatim everywhere — a reference is not a
secret, and seeing it is how you know which credential a request uses.

## Never write \`<SECRET>\` back

\`<SECRET>\` is what a read substituted for a value; it is not a value. Writing it
back replaces a working credential with a literal that gets sent upstream on the
next run, so \`workflows_create\`, \`workflows_update\`, \`workflows_patch\` and the
preset tools reject it and name the offending paths.

When editing something you read: send the real value, send a
\`{{secrets.NAME}}\` reference, or omit the field. With \`workflows_patch\` you can
usually omit it — patch only touches the nodes you name.

## Run reads

Runs are metadata only: status, timing, per-node status and status code,
assertion outcomes with the *type* and *state* of actual values but never the
values themselves. No response bodies, headers, cookies, URLs or variable values
cross this bridge on any run tool except one: \`runs_getNodeResult\` returns the
full stored request/response for a single node of a run, body included, after
the same secret-redaction pass every other read gets — secret-shaped values in
the body, headers, URL or request come back withheld. Everything else about
runs stays metadata-only; to see other payloads, open the run in the desktop
app.

This is why \`assertion_suggest\` exists: it reads the stored response
server-side and returns *rules*, so you get verified paths without the payload.

## Secrets

\`secrets_list\` and \`secrets_resolve\` return names, scopes and which scope a
name binds to — never a value, plaintext or encrypted. Secrets cannot be created,
changed or deleted over MCP; that is a desktop action.
`

export const MCP_GUIDES: readonly McpGuide[] = [
  {
    slug: "start-here",
    title: "Start here: building an APIWeave workflow",
    description:
      "How to author a workflow over MCP, and the order of operations that finds mistakes statically instead of with live HTTP requests.",
    text: START_HERE,
  },
  {
    slug: "workflow-authoring",
    title: "Nodes and edges",
    description:
      "Every node type with its config shape, the pass/fail edge handles an assertion requires, and how to change a graph without resending it.",
    text: WORKFLOW_AUTHORING,
  },
  {
    slug: "placeholders",
    title: "Placeholders and variable interpolation",
    description:
      "The {{env.x}}, {{variables.x}}, {{prev.x}} and {{secrets.x}} namespaces, extractor paths, and what happens when one does not resolve.",
    text: PLACEHOLDERS,
  },
  {
    slug: "assertions",
    title: "Assertion rules",
    description:
      "What path means for each assertion source, the operator rules, worked examples, and the suggest/validate/apply flow.",
    text: ASSERTIONS,
  },
  {
    slug: "diagnostics",
    title: "Diagnostic codes",
    description: "What every workflow_diagnose code means and how to fix it.",
    text: DIAGNOSTICS,
  },
  {
    slug: "redaction",
    title: "What MCP reads withhold",
    description:
      "Which values are redacted from reads, why the structure is still intact, and why <SECRET> must never be written back.",
    text: REDACTION,
  },
]
