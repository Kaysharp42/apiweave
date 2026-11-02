# MCP token efficiency and code-map guidance

Status: planned, 2026-11-02.

## 1. Goal

Cut what an agent pays to connect to, orient in, and work through APIWeave's
local MCP server, and point launched agents at a code-mapping tool (graphify)
when they read the user's API source, so they query a graph instead of grepping.

Each phase ships on its own and leaves a working product. Phase 0 comes first so
every later phase has before/after numbers.

## 2. Decisions (made by the user, 2026-11-02)

| # | Decision |
|---|---|
| D1 | **Write tools advertise a loose node shape.** Agents learn per-type node configs from a new `workflows_nodeSchema({ type })` tool and from precise validation errors, not from the full schema inlined into every write tool. The router keeps validating against the real `WorkflowNodeSchema`. |
| D2 | **Keep the current tool surface otherwise.** Bundle export/import, node presets, workspace create/update/delete and the `*_moveToWorkspace` tools all stay. Only `workflows_update` (superseded by `workflows_patch`) and `guides_list` (duplicated by `server_info`) are removed. |
| D3 | **Code-map guidance lives in the per-session briefing, conditionally,** plus one sentence in the `start-here` guide. Nothing is added to `MCP_INSTRUCTIONS`, which is static, paid on every connection, and capped at 1,600 bytes by `phase5-edit-path.test.ts`. |
| D4 | **graphify is the recommended code map.** codebase-memory-mcp is mentioned as a link only, because APIWeave cannot detect it: it lives in the agent's own MCP configuration. |

## 3. Baseline (measured 2026-11-02)

Token counts use the `o200k_base` tokenizer as a proxy; Claude's tokenizer will
differ somewhat. Task numbers come from an in-memory database with a 42-node
workflow, nine 18-node workflows, one failed run and 19 passed runs.

| Cost | Size |
|---|---|
| `MCP_INSTRUCTIONS` | 1,228 chars ≈ 301 tok |
| `tools/list` on the wire (59 tools) | 334,816 B ≈ 86k tok |
| Model-visible catalogue (name + description + inputSchema) | ≈ 40.4k tok |
| …node schema inlined in `workflows_patch` / `workflows_create` / `workflows_update` | 10,195 / 9,765 / 9,833 tok (≈ 29k, 73%) |
| outputSchemas (wire only; no client shows them to the model) | ≈ 43.5k tok |
| Session briefing (Claude Code, OpenCode, Aider, Pi) | 393 tok |
| Guides | start-here 1,199 · workflow-authoring 2,728 · placeholders 993 · assertions 1,169 · diagnostics 979 · edit-debug 562 · redaction 572 |

| Task (42-node workflow) | Calls → response tokens |
|---|---|
| Orient | `server_info` 341 + start-here 1,351 + edit-debug 633 ≈ 2.3k |
| Find and patch | search 224 → get **4,870** (default full) or 2,116 (outline) → searchNodes 1,408 → get nodes 415 → patch 106 |
| Debug a failed run | `workflows_debugContext` 3,101 + `runs_getNodeResult` 477 |
| Add assertion | suggest 483 + get (only for `rev`) 262 + apply 106 — 3 calls |
| Run history, 20 rows | `runs_history` 3,234 |

A full read of the 500-node harness fixture is 134 KB, past Claude Code's
default 25k-token MCP output limit.

### Inside the node-schema duplication

- http-request alone is 4,067 tok, sse 2,077; `auth` (1,302 tok) is duplicated
  between them inside every copy.
- 534 description strings across the catalogue total 14.7k tok, but only 148
  are unique (4.2k tok).
- `bridge.ts:78` passes `reg.input` through unchanged; `bridge.ts:26-57`
  already advertises a looser schema on the output side, which is the
  precedent for D1.

### Client behaviour that matters

- Claude Code and Codex show `structuredContent` to the model when present;
  Cursor shows only the `content` text. Keep both channels.
- No client shows `outputSchema` to the model (OpenCode unverified).
- Claude Code defers MCP tools behind tool search by default: the model sees
  names and the start of each description, and pays a tool's full schema when
  it loads it. `_meta: {"anthropic/alwaysLoad": true}` opts a tool out.
- OpenCode loads every tool up front (believed, not verified).

## 4. Bugs found

| # | Bug | Where |
|---|---|---|
| B1 | A `ZodError` thrown by a handler (node parse in the service) is labelled `"response validation failed"`, and its path is relative to the node with no list index or `nodeId`. | `core/ipc/router.ts:114-118`, `core/services/workflow_service.ts:169,190` |
| B2 | `workflows_get` defaults to `view: "full"` with no size limit, while the tool says to prefer outline; the briefing and the `author_assertions` prompt send agents there without a view. | `core/ipc/handlers/workflows.ts:225`, `core/agents/session_briefing.ts:99`, `core/mcp/prompts.ts` |
| B3 | Nodes blocked by an already-reported failure produce false `extractor_producer_not_executed` warnings (12 in the test run, ≈ 800 tok). | `shared/analysis/workflow_graph_analyzer.ts:870-874` |
| B4 | `graphCorrelation` is always "unknown": runs do not record the workflow `rev` they ran against. | `core/services/debug_context.ts:100-103` |
| B5 | With MCP not wired, the briefing says "launched without APIWeave's MCP server" twice. | `core/agents/session_briefing.ts:90,104` |
| B6 | The harness measures a `workflowList` payload no exposed tool returns, and its catalogue total mixes wire bytes with model-visible bytes. | `core/mcp/harness/fixtures.ts:43`, `core/mcp/harness/catalogue.ts` |

## 5. Phases

### Phase 0 — Measure

- Add a model-visible metric to `catalogue.ts`: name + description +
  inputSchema, excluding outputSchema. Report per tool and in total.
- Add payload measurements for `workflows_search`, `workflows_get` outline,
  `workflows_debugContext` and `runs_history` on the 10/130/500-node fixtures.
  Remove the `workflowList` measurement (B6).
- Add a scripted task driver that runs the task table in §3 through a real MCP
  client and records calls and response bytes per task. `MCP_TASK_FIXTURES`
  today is descriptive only.

Done when `npm run mcp:baseline` prints the §3 numbers and the vitest harness
test asserts their shape.

### Phase 1 — Correctness and cheap wins

1. **`workflows_get` defaults to outline over MCP** (B2). Default `view` in
   `dispatchAsTool` (`bridge.ts`), the same way `waitMs` is defaulted at
   `bridge.ts:125`. Refuse `full` above a size budget with an error that names
   `outline` / `nodes`. Update the briefing and the `author_assertions` prompt
   to say `view: "outline"`.
2. **Precise node validation errors** (B1). Report a handler-side parse failure
   as request validation, with the path prefixed by the list, index and nodeId
   (e.g. `upsertNodes[2] (nodeId "login").config.method`). This is a
   prerequisite for Phase 3.
3. **`assertion_suggest` returns `rev`**, so adding assertions needs no extra
   `workflows_get`.
4. **Trim `runs_history` rows** to `runId, status, startedAt, durationMs,
   failedNodeCount`, plus `failedNodes` when non-empty (3,168 → ≈ 664 tok).
   Drop ids the caller already supplied from `workflows_search` rows (≈ −35%),
   per projection — not globally, since `collectionId: null` means unassigned.
5. **Short cursors.** Store a filter fingerprint, position and snapshot, with a
   16-byte HMAC, instead of base64 JSON that repeats re-supplied filters
   (≈ 246 → 50–60 tok, paid in the response and again in the next request).
   `core/ipc/opaque_cursor.ts`, `core/services/workflow_reads.ts:31`.
6. **Quieter `debugContext`.** Skip extractor warnings for nodes in
   `blockedNodeIds` (B3); stop repeating blocked ids in
   `http_request_failed.nodeIds`; record the workflow `rev` on each run so
   `graphCorrelation` reports current or stale (B4). ≈ −1k tok.
7. **Compact the run resource** (`resources.ts:85` pretty-prints: 602 → 372 tok)
   and fix the duplicated briefing line (B5).

### Phase 2 — Recommend graphify and make agents use it

1. **Detect at launch, in main.** In `AgentService.briefingFor`
   (`core/services/agent_service.ts:695`), where `cwd` is already validated as a
   directory: `existsSync(<cwd>/graphify-out/graph.json)` and
   `resolveExecutable("graphify")` (synchronous PATH walk, no spawn; the login
   PATH is already hydrated at boot). Pass the result as an optional
   `AgentBriefingContext` field.
2. **Conditional briefing section** in `buildSessionBriefing`, after the "The
   workflow is not in this folder" section, ≈ 50 tok:
   - Graph present: use `graphify query "<route or handler>"`,
     `graphify path A B` and `graphify explain X` to learn routes,
     request/response shapes and auth instead of grepping; `GRAPH_REPORT.md`
     for broad context only.
   - Executable present, no graph: one line suggesting `/graphify .`.
   - Neither: nothing.
   - Paths only. Never interpolate `GRAPH_REPORT.md` or other repo content:
     it would become the next agent's standing instructions.
3. **One sentence in the `start-here` guide** so agents without a briefing
   carrier (Codex, Gemini, Copilot, Qwen) still get the hint on demand.
4. **Dismissible card in Settings → Agents**, under the intro paragraph
   (`src/components/organisms/AgentsSettingsPanel.tsx:249`). Built from `Card`,
   `Button`, `IconButton` and `TutorialCodeBlock`; dismissal persisted in
   `localStorage` following `useCanvasTip`. Copy-paste prompt:

   > Install graphify for this repository: run `uv tool install graphifyy`
   > (or `pipx install graphifyy`), then `graphify install --project`, then
   > build the graph with `/graphify .`. Ask me whether to commit or gitignore
   > `graphify-out/`.

   State that the official PyPI package is `graphifyy` (double y) and that other
   `graphify*` packages are not affiliated. Link codebase-memory-mcp as an
   alternative without install instructions until they are verified.
5. **Docs:** a "Giving the agent a map of your code" section in
   `docs/features/mcp-integration.md`, between "Agent Workflow Example" and
   "Troubleshooting", linked from `docs/features/README.md`.
6. **Tests:** `agent_service.test.ts` (graph present / executable only / neither,
   in the temp cwd); `session_briefing.test.ts` (each wording, nothing from the
   repo interpolated); `AgentsSettingsPanel.test.tsx` (card renders, dismissal
   persists). Keep the new context field optional so the literal contexts in
   `session_briefing.test.ts:23` and `phase5-edit-path.test.ts:525,537` still
   type-check, or update them.

### Phase 3 — Cut the tool catalogue (D1, D2)

1. **Loose node shape on write tools.** Advertise node items in
   `workflows_create` / `workflows_patch` as `{ nodeId, type (enum), label?,
   parentId?, position?, config (record) }`. Dispatch still validates with the
   real schema; Phase 1 item 2 makes the errors usable.
2. **`workflows_nodeSchema({ type })`.** Returns the JSON Schema for one node
   type's config, generated from the same zod definition so it cannot drift.
   Registered through the IPC handler registry and added to the MCP whitelist.
3. **Remove `workflows_update` from MCP** and add `tags` to `workflows_patch`.
   Update the guides and instructions that mention update. Remove `guides_list`
   (`server_info` already lists guides).
4. **Trim descriptions.** Drop the output-schema sentences
   (`workflows_get`, `debugContext`), pagination text the `limit`/`cursor` field
   descriptions already carry, and the "Returns revision/counts and one
   diagnosis; touched ids stay empty" sentence on the write tools. Put search
   keywords first, since Claude Code's tool search reads only the start.
5. **Merge `edit-debug` into `start-here`** (target ≤ 900 tok) and update the
   pointers in `MCP_INSTRUCTIONS` and the briefing.
6. **Then** mark `workflows_search`, `workflows_get`, `workflows_patch`,
   `workflows_debugContext` and `runs_create` with
   `_meta: {"anthropic/alwaysLoad": true}`. Not before item 1, or Claude Code
   loads the 10k-token patch schema in every session.
7. Optional, wire-only: drop or cache the largest outputSchemas
   (`workflows_get` 11k, `debugContext` 3.1k, `getNodeResult` 1.5k tok); they
   are re-converted on every stateless request (`host.ts:263`).

Target: model-visible catalogue ≈ 40.4k → 12–13k tok. Verify with a scripted
trial that creates an http-request node with bearer auth and retry, counting
error/retry rounds.

**Done (2026-11-02).** `npm run mcp:baseline`, Phase 2 → Phase 3:

| Measure | Before | After |
|---|---|---|
| Tools | 59 | 58 (−`workflows_update`, −`guides_list`, +`workflows_nodeSchema`) |
| Model-visible catalogue | 174,039 B | 53,979 B (−69%, ≈ 13.5k tok at 4 B/tok) |
| …`workflows_patch` / `workflows_create` | 43,475 / 41,600 B | 5,201 / 4,185 B |
| `tools/list` on the wire | 333,134 B | 210,885 B |
| Orient task | 3 calls, 10,732 B wire | 2 calls, 6,599 B wire |

Other scripted tasks are byte-identical. The trial
(`core/mcp/__tests__/token-efficiency-phase3.test.ts`) takes 4 calls:
`workflows_nodeSchema`, one rejected draft whose issues name
`["nodes", 1, "config", "body"]` and `…retry…`, the corrected create, and a
read-back.

Notes:
- The loose node items are `z.looseObject`: the SDK validates arguments
  against the advertised schema before the handler runs, so a stripping schema
  would hide unknown keys from the router. The top level stays strict.
- `workflows.update` stays as an IPC handler (the renderer's save path);
  `guides.list` had no renderer caller and was deleted with
  `GuideSummarySchema`.
- `start-here` absorbed `edit-debug` at 3,353 chars; `MCP_INSTRUCTIONS` is
  1,154 B.
- Item 7 is not done. The SDK converts zod to JSON Schema only inside its own
  `tools/list` handler, not on every request, so caching would mean replacing
  that handler. outputSchemas are wire-only, so they were kept.
- A header map is not a validation error: `canonicalizeNodeConfig` accepts it
  as a legacy shape. The trial uses an object body and a misnamed retry field
  instead.

### Phase 4 — Search and discovery ("graphify for workflows")

1. **Workspace-wide `workflows_searchNodes`.** Make `workflowId` optional
   (backed by the existing `workflows.searchWorkspaceNodes` handler, which then
   stays off the whitelist as its own tool), and return `method` and `urlPath`
   per match. N+1 calls → 1.
2. **Reference and path search.** Match placeholder references
   (`{{variables.x}}`, `{{env.X}}`, `{{secrets.X}}`) in url, headers, body and
   mappings, and assertion paths. References survive reads verbatim, so this
   reveals nothing new.
3. **`workspaces_map`.** Paged; per workflow: id, name, rev, deduped endpoints
   (`METHOD /path/{{…}}`), variables produced and consumed, env/secret
   references, sub-workflow calls, last run status. Built only from fields
   `matchNodeFields` already reads. Estimated 1–3k tok for 10–30 workflows.
4. Update the briefing and `start-here`: graphify for the code,
   `workflows_searchNodes` / `workspaces_map` for the workflows.

**Done (2026-11-02).** `npm run mcp:baseline`, Phase 3 → Phase 4:

| Measure | Before | After |
|---|---|---|
| Tools | 58 | 59 (+`workspaces_map`) |
| Model-visible catalogue | 53,979 B | 55,394 B (+2.6%) |
| …`workflows_searchNodes` / `workspaces_map` | 1,223 B / — | 1,833 / 805 B |
| `MCP_INSTRUCTIONS` | 1,154 B | 1,203 B |
| "Which nodes hit `/orders`?" over the 10-workflow seed | 11 calls, 26,849 B wire / 12,056 B text (`map-route-per-workflow`) | 1 call, 13,795 / 6,386 B (`map-route`) |
| `workspaces_map`, 10 seeded workflows | — | 1 call, 3,442 B text (≈ 0.9k tok) |
| `workspaces_map`, 30 workflows × 8 requests (one-off measurement) | — | 11,683 B (≈ 2.9k tok), one page |
| find-and-patch task | 7,591 B text | 8,019 B (+`method`/`urlPath` on each match) |

Other scripted tasks and every fixture payload are byte-identical; the
`workspacesMap` fixture payload is 296 / 828 / 1,360 B for workspaces of 1, 2
and 3 fixture workflows (their URLs carry no placeholders, so the 20-endpoint cap
and `omitted` show).

Notes:
- One implementation: `core/services/node_facts.ts` extracts a node's endpoint
  and placeholder references; node search and the map are both built from it.
  `matchNodeFields` (query over safe fields) is unchanged in scope and is
  combined with the reference filter in `matchNode`.
- `workflows.searchWorkspaceNodes` is deleted rather than kept off the
  whitelist: the command palette was its only caller and now calls
  `workflows.searchNodes` without `workflowId`, so there is one handler and one
  page shape (`WorkspaceNodeMatchSchema`/`WorkspaceNodeSearchPageSchema` went
  with it).
- A one-workflow match does not repeat `workflowId` (the page states it once,
  as Phase 1 did for search rows); workspace-wide matches carry `workflowId` and
  `workflowName`.
- `urlPath` now drops a leading `{{…}}` base reference (`{{env.BASE}}/users` →
  `/users`) and passes through `sanitizeUrlWithReferences` first, so userinfo
  and credential-looking path segments never reach it. The base reference is
  still findable with `ref`.
- Map endpoints collapse placeholders to `{{…}}` so a route called with
  different variables is one entry; the names are in `consumes`.
- The map pages with a keyset over `WorkflowRepository.listGraphPage` (the
  `listSummaries` filter and order, whole workflows) and reads the page's
  latest runs with one windowed query (`RunRepository.latestRunsByWorkflow`).
- The project-scope briefing now points at `workspaces_map` with
  `collectionId` instead of `workflows_search`. `MCP_INSTRUCTIONS` gained one
  pointer (`workspaces_map` to orient in a whole workspace); `start-here` is
  3,597 of its 3,600 chars.

## 6. Not doing

- Pruning export/import, node presets, workspace CRUD or `*_moveToWorkspace`
  tools (D2).
- `$defs`/`$ref` schema sharing: unnecessary once D1 lands, and some clients
  (Gemini especially) handle `$ref` unreliably.
- Outline as positional rows instead of objects (−29%): revisit only if
  Phase 0 numbers show the outline is still a top cost.
- Any code-map guidance in `MCP_INSTRUCTIONS` (D3).
