# APIWeave MCP optimization — research and implementation plan

Date: 2026-09-09  
Status: phases 0–6 implemented on branch `mcp-optimizations` (commits `e7d8387`, `e40c85c`, plus review fixes still in the working tree). The plan text below, and every number in §2, are the pre-implementation baseline and are kept unedited for comparison; §7 carries the measured post-implementation catalogue and records which targets remain unratified.

## 1. Decisions confirmed with the user

- Scope: APIWeave's local MCP bridge.
- Goal: balance fewer agent round trips, lower response/context token usage, latency, and successful task completion.
- Breaking MCP interface changes are allowed. Remove superseded paths rather than introduce compatibility layers.
- Acceptance target: all built-in agents, accounting for their actual MCP capabilities.
- Primary workload: edit and debug existing workflows, especially small edits to large graphs.

**Recommendation:** optimize the existing typed MCP surface in layers: measure, compact schemas/results, targeted reads, one-call debugging context, bounded run waiting, then evidence-driven tool consolidation. Preserve the shared router/service/repository architecture. Treat agent success per total task cost as the objective, rather than minimizing individual responses or tool count in isolation.

## 2. Investigation and measured baseline

### Method and limits

Used the existing graphify graph to locate the MCP/IPC/service relationships, then inspected the implementation, schemas, repositories, run broker, agent briefing, prompts, built-in roster, and MCP tests. The codebase-memory MCP tools were unavailable in this session. The broad graph query was truncated; concrete findings below were checked directly against source.

The catalogue probe connects an SDK `Client` to the real `createMcpServer` over `InMemoryTransport`, registers the real handler schemas, and calls `listTools`. Services are placeholders and are never invoked by that probe. It accesses no user database and starts no workflow runs. Reproduction:

```powershell
.\app\node_modules\.bin\tsx.cmd --tsconfig app/tsconfig.desktop.json docs/.scratch/mcp-audit-measure.ts
```

The same scratch script measures synthetic objects using production schemas and run projections. These are **UTF-8 JSON byte counts**, not tokenizer results, production traces, or end-to-end performance measurements. Catalogue counts exclude JSON-RPC/HTTP framing. Clients differ in which schemas/results reach the model; do not equate wire size with billed tokens. The resolved MCP SDK is 1.29.0 in `app/package-lock.json` (the manifest declares `^1.23.0`).

### Catalogue

| Measurement | Bytes |
| --- | ---: |
| Entire `tools/list` result, 55 tools | 527,748 |
| Sum of input schemas | 100,392 |
| Sum of output schemas | 407,177 |
| Sum of tool descriptions | 7,962 |
| Initialize instructions text | 1,357 |

Output schemas account for approximately **77.2%** of the catalogue; tool descriptions account for approximately **1.5%**. Description trimming alone cannot materially fix the catalogue size.

| Largest tool definitions | Total bytes | Input schema | Output schema |
| --- | ---: | ---: | ---: |
| `workflows_patch` | 58,594 | 26,674 | 30,827 |
| `workflows_create` | 57,061 | 25,561 | 30,827 |
| `workflows_update` | 56,976 | 25,612 | 30,827 |
| `workflows_layout` | 32,124 | 823 | 30,827 |
| `assertion_apply` | 28,304 | 2,454 | 25,486 |
| `workflows_get` | 26,369 | 441 | 25,309 |
| `workflows_list` | 25,969 | 223 | 25,499 |

Several membership/environment/move tools also carry approximately 25 KB output schemas because they return a full workflow.

### Synthetic response sizes

Fixture: 130 nodes, consisting of start/end and 128 minimal GET requests; 129 edges. Run fixture: 130 passed node results with status code and duration, no bodies. Ten-workflow list repeats that graph under different workflow IDs. These are illustrations of scaling, not representative user-data averages.

| Payload | Compact JSON bytes | Current-style pretty JSON bytes |
| --- | ---: | ---: |
| One full workflow | 22,895 | 39,742 |
| Ten full workflows in a list | 228,942 | 485,914 |
| One-node patch summary with duplicate diagnosis | 344 | 532 |
| Same summary with diagnosis only at top level | 241 | 357 |
| Current run-tool projection | 31,798 | 49,305 |
| Existing run-resource projection | 7,897 | 12,495 |

These counts cover the logical JSON/text payload, not both MCP result channels together. The existing run-resource representation is already about 75% smaller in compact bytes than the run-tool representation on this fixture. Even it still grows with node count.

Guide sizes: start-here 4,231 bytes; workflow-authoring 8,531; placeholders 4,055; assertions 3,267; diagnostics 3,773; redaction 2,465. The first three total 16,817 bytes. They are fetched on demand, not all included in initialization.

## 3. Code findings

### Existing strengths to build upon

- Explicit whitelist and intent annotations: `app/core/mcp/tools.ts:62–136`.
- Shared validate/authorize/service/redact path: `app/core/ipc/router.ts:174–215,263–267`.
- Recursive partial graph patches, revision checks, and compact patch returns: `app/core/ipc/handlers/workflows.ts:86–148,208–225`; `app/core/services/workflow_service.ts:223–249`.
- Automatic diagnosis after graph writes: `app/core/mcp/bridge.ts:88–169`.
- Targeted node reads: `app/core/ipc/handlers/workflows.ts:167–179`.
- Metadata-only run reads and a smaller resource snapshot: `app/core/mcp/run-projection.ts`.
- Stateful HTTP sessions and resource subscriptions already exist: `app/core/mcp/host.ts:219–268`; `app/core/mcp/resources.ts:98–137`.
- Broker already has bounded replay and sequence numbers: `app/core/runner/run_event_broker.ts:40–79`.
- Assertion suggestions derive rules server-side without shipping the response body: `app/core/services/assertion_authoring_service.ts:30–117`.
- Existing MCP tests cover whitelist exclusions, redaction, stale revisions, partial edits, layout, resource notifications, and transport lifecycle: `app/core/mcp/__tests__/mcp.test.ts`.

### Prioritized gaps

| Priority | Finding and evidence | Consequence |
| --- | --- | --- |
| P0 | MCP directly republishes large IPC output schemas (`bridge.ts:31–45`). SDK regenerates JSON Schema inside each tools-list request (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:67–99`). | Large discovery payload, repeated graph unions, avoidable conversion work. Actual model exposure depends on client. |
| P0 | Workflow lists return `listResult(WorkflowSchema)` with no query/limit/cursor (`handlers/workflows.ts:188–192`). Repository reads all graph columns (`WorkflowRepository.ts:126–145`). | Finding a workflow can transfer every graph. Default `includeAttached=false` also hides project workflows, making discovery misleading. |
| P0 | Create/update default to `full`; assertion apply returns `{workflow, revision}` (`handlers/workflows.ts:153–165,194–205`; `assertion_authoring_service.ts:181–203`). Membership/environment tools return full workflows too. | Small writes can echo an entire graph and require enormous output schemas. |
| P0 | `splitDiagnosis` keeps `result.diagnosis` and repeats it at top level (`bridge.ts:121–145`). Responses also use pretty JSON and both text/structured channels (`bridge.ts:98–112`). | Within-payload duplication is certain. Duplication in model context between channels needs client measurement. |
| P0 | Bridge discards router error details (`bridge.ts:115–118`), although conflict errors have current/expected revisions and validation errors have issues. | Agent cannot correct a known error efficiently; repeated guess/retry loops. |
| P0 | `safeDiagnose` catches failure and returns zero errors with no diagnostics (`handlers/workflows.ts:332–346`). | Analysis unavailable can appear clean; optimizations must distinguish saved/checked/valid. |
| P1 | Filtered workflow reads return only edges between selected nodes (`handlers/workflows.ts:173–177`). No boundary edges or node search. | To insert/rewire a node, the agent must already know adjacent IDs or fetch the whole graph. |
| P1 | Run-tool projection emits both `nodeStatuses` and `results`, including empty arrays/nulls and successful assertion/extractor metadata (`run-projection.ts:33–122`). | Repeated status checks scale with all completed work rather than changes or failures. |
| P1 | Run lists have no pagination and load full stored rows before projection (`handlers/runs.ts:88–98`; `RunRepository.ts:120–138`). | Output and main-process work grow with history. |
| P1 | Node-result tool returns one entire request/response with no section/path/size selection (`handlers/runs.ts:13–28,56–85`). | Debugging one error field can consume a large body. Several failures require several calls. |
| P1 | `runs_create` starts asynchronously and returns a snapshot; no wait operation (`run_service.ts:51–65`). Resource updates notify on every matching event and require re-read (`resources.ts:106–119`). | Agents may repeatedly poll. Subscriptions alone do not remove model-level polling across all clients. |
| P1 | Debug context is fragmented across workflow, latest failed run, node result, diagnosis, environment, and secret metadata tools. | Repeated related reads and intermediate results pass through the model. |
| P1 | Assertion apply already validates internally, but guide/prompt prescribe separate validate then apply (`assertion_authoring_service.ts:189–202`; `guide.ts:464–481`; `prompts.ts:64–68`). | Potential redundant validation round trip. Evidence-based validation and explicit preview are distinct cases and must remain supported. |
| P1 | Whole-graph auto-layout occurs even on config-only patches and reads the graph before dispatch (`bridge.ts:184–211`). | Extra work and unnecessary canvas movement for the primary edit/debug workload. Layout computation can be based on a different revision than the eventual service read. |
| P1 | Instructions conflict: end-node schema allows several ends (`WorkflowNodeSchema.ts:100`), analyzer rejects duplicate ends (`workflow_graph_analyzer.ts:280–282`), guides require exactly one. Guide also says all other nodes have one output after separately describing SSE's two outputs (`guide.ts:261–272`). | Avoidable incorrect authoring and repair calls; shorter wording alone would not fix this. |
| P2 | Briefing duplicates initialize conventions, says every write diagnoses, and project guidance points at workspace workflow listing (`session_briefing.ts:87–110`). | Extra context plus misleading discovery/response expectations. Not every write tool diagnoses. |

Architecture documentation also contains stale stateless-only comments in `server.ts:13–20`; inspect the host rather than planning to add sessions that already exist.

## 4. Research conclusions

Primary sources accessed during this review:

1. [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), Sep 2025. Supports task-oriented tools, concise/detailed responses, bounded filtering, actionable errors, and evaluations measuring success, calls, latency, and tokens.
2. [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), Nov 2025. Shows why intermediate data should stay outside the model and tools can be loaded progressively. Its reported 98.7% reduction is an example from a different workload, **not an APIWeave forecast**.
3. [Cloudflare: Code Mode](https://blog.cloudflare.com/code-mode/). Illustrates programmatic composition and isolated execution. Its hosted isolate infrastructure is not a drop-in dependency for this desktop app.
4. [MCP tools specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). Output schemas are optional; when supplied, structured results must conform. Serialized JSON text alongside structured content is recommended. Tool-list pagination is a transport facility, not a guarantee of lazy model-context loading.
5. [MCP Streamable HTTP specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). POST bodies contain a single JSON-RPC message. Use domain composition or an explicit bounded tool for batching, not JSON-RPC batch arrays. Disconnect does not itself mean cancellation.
6. [MCP tasks specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks). Tasks are marked experimental in this version; they require capability negotiation and deferred result retrieval. They do not automatically remove polling or work across every client.
7. [Zod JSON Schema documentation](https://zod.dev/json-schema). Supports reuse through local references. The installed SDK converter currently forwards target/io only (`server/zod-json-schema-compat.js:18–24`), so a `reused: "ref"` option cannot simply be passed to `registerTool`.

Implications:

- Optimize the data and operation design first. Gzip reduces network bytes, not decompressed model tokens; loopback network cost is unlikely to dominate.
- Keep strict, helpful schemas. Replacing every argument/result with an untyped object would make discovery smaller but shift cost into errors and guide reads.
- Compact structured results plus equivalent compact JSON text is the initial result policy. Remove within-payload duplication immediately; change dual-channel delivery only after client evidence.
- Keep IDs and revisions needed for the next operation. Omitting them to save tokens commonly adds a read.
- Prefer deterministic server-side debug aggregation and bounded waiting over embedding a new LLM or arbitrary code runtime.
- Static, stable tool definitions help clients that cache or search tools. Server-side discovery does not automatically control a third-party client's model context.

## 5. Target design

### 5.1 Typed agent-facing contracts over shared services

Separate the MCP response contract from the renderer's full domain objects. The bridge may map/compact data and expose smaller schemas; execution continues through registered IPC operations and shared services. New business operations belong in the registry and are explicitly whitelisted.

Suggested layout:

```text
app/core/mcp/
  bridge.ts                 # validation/dispatch, projection, result encoding
  tools.ts                  # explicit inventory, names, intent, concise descriptions
  projections/              # workflow, run, diagnosis, error transport projections
app/core/ipc/handlers/
  workflows.ts              # scoped reads/search/debug context, existing writes
  runs.ts                   # bounded run queries, evidence selection, waiting
app/core/services/          # authorized domain orchestration
app/core/repositories/      # narrow queries, pagination, revision-safe persistence
app/shared/types/           # one new shared contract type per file + barrel exports
app/shared/zod-schemas/     # matching schemas
```

Follow the existing shared-type placement for core/shared contracts; renderer-only types stay under `app/src/types/`. Avoid a generic transformation framework: use named projections with explicit schemas for the few domains that need them.

Prefer compact output DTOs to repeating full workflow unions on each operation. For actual full-detail reads, keep the accurate schema, reuse local schema definitions where supported and beneficial, and measure client behavior. Do not introduce external schema URLs that require extra network resolution. Do not modify SDK private fields or fork its schema converter to achieve the first phase.

### 5.2 Standard compact write result

Graph writes should return IDs, workflow revision, counts, touched IDs, and **one** bounded diagnosis:

```json
{
  "result": {
    "workflowId": "wf_123",
    "rev": 42,
    "nodeCount": 130,
    "edgeCount": 194,
    "touchedNodeIds": ["check_order"],
    "touchedEdgeIds": []
  },
  "diagnosis": {
    "status": "complete",
    "summary": {"errors": 0, "warnings": 0, "notices": 0},
    "items": []
  }
}
```

- MCP create/update/apply/membership/config writes default to appropriate summaries. Renderer full-object needs are explicit contract choices, not a reason to echo full objects to agents.
- Graph diagnosis includes status `complete` or `unavailable`; an unavailable check never reports a clean result. Successful persistence remains success if subsequent analysis fails.
- Diagnosis shows errors first, then warnings, with node/edge IDs and a short actionable remediation. Notices are counted and available on demand.
- Start with at most 20 inline issues and 10 KiB total diagnostic detail; preserve total severity counts and explicit omission metadata. These are initial benchmark values, not immutable requirements.
- Large touched-ID lists need bounded slices and explicit totals/continuation too.
- If `full` return is retained for deliberate verification, it is opt-in. Prefer a single diagnostic sibling regardless of shape.
- Return sanitized error details: issue path/code/expected shape, current and expected revision on conflict, and whether a write committed. Never return raw Zod objects that can embed submitted values.

### 5.3 Targeted discovery and graph reads

**Workflow listing/search:** extend the MCP-facing workflow query to accept query text, project/collection filter, tags if already useful, limit and cursor. List summaries include workflowId, name, rev, project/environment IDs, node/edge counts and optional short description. Do not include configs, variables, or graph arrays by default. Search all project-attached workflows unless a filter says otherwise.

**Workflow read:** support `view: "outline" | "nodes" | "full"`. Outline returns identity/revision plus bounded node IDs/types/labels and edge structure, excluding canvas positions/config bodies. Node view returns selected configs and incident edges, with minimal boundary-node identities. Explicitly mark partial reads; never present a filtered graph as complete.

**Node search:** use labels/types and safe request method/URL path fields to locate relevant nodes. Return node IDs plus enough neighboring structure to patch. Avoid body-wide unbounded search and regex execution in the main process. The search itself must not match withheld secret values.

Initial limits: list 20 workflows (max 100), node query 20 matches (max 100), node detail 10 nodes (max 50), and a 32 KiB inline result budget. Large full views need explicit bounded continuation; no silent JSON string slicing. Group/note nodes and parent-relative layout must remain representable.

Pagination belongs in repository queries, with deterministic ordering/tie-break IDs and opaque filter-bound cursors. A response returns `nextCursor` only when more data exists. Fetch `limit + 1` rather than calculate expensive exact totals unnecessarily. Continuations over a changing graph must be revision-bound; stale cursors should request a fresh read.

### 5.4 One-call debug context

Introduce `workflows_debugContext` backed by a shared service operation, with:

```text
workspaceId, workflowId,
runId? (otherwise latest failed, with the selected policy explicit),
nodeIds?, issueLimit?, evidence detail selection?
```

Default response:

- Workflow identity/current revision, chosen run identity/status/revision and timestamps.
- Failed/blocked node summary and run-correlated diagnosis.
- Configs of relevant failed nodes and their nearest dependencies; incident edges with handles.
- Unresolved placeholder names; environment selection and relevant key-presence/provenance; secret names/resolution metadata only.
- Bounded, redacted error evidence from affected results, with selectors for more detail.
- Explicit omissions and continuation/next-read arguments when the budget is exceeded.

Use deterministic filtering and existing analysis/scope logic, no LLM summarizer. Cap the aggregate response, not just each section. Start at 32 KiB with at most five failed-node detail entries; counts still describe all failures.

Read the graph once per operation and analyze that snapshot. Resolve the selected run once, rather than letting each sub-read choose a different latest run. Return current workflow rev separately from runRev. Current run records do not expose the executed workflow revision in the reviewed contract: label historical graph correlation as unknown when it cannot be proven, and consider recording the executed revision on new runs. Never assume a past run describes the graph now on canvas.

For a known active workflow, the desired diagnosis path becomes one debug-context call plus optional targeted evidence, replacing a chain of workflow/run/diagnose/environment reads. It remains possible to use the granular tools for unusual investigations.

### 5.5 Compact runs and targeted evidence

- Run list defaults to runId, workflowId/name where useful, status, timing, failed-node count and revision. No per-node results on every history row.
- Run summary defaults to aggregate status/counts and failure details. Use a single per-node representation when node detail is requested, rather than duplicate `nodeStatuses` and `results`.
- Preserve `expectedStatus` for negative tests and unresolved placeholder names, since dropping these causes wrong diagnoses.
- Extend node-result retrieval to accept a small `nodeIds` set, requested sections (`error`, `assertions`, `extractors`, `request`, `response`), and bounded path/range selection for JSON/text bodies.
- Keep path evaluation deterministic and reuse the project's path resolver where semantics agree; do not expose JS evaluation or an arbitrary query language.
- Report `missing`, `redacted`, `stored_truncated`, and `output_omitted` distinctly. Never imply the stored full body is retrievable when the runner captured only part of it.
- Redact while original body/header/URL context is intact, then select paths or generate previews. Extracting a credential leaf into a generic `value` field before redaction can lose its masking context.
- Retrieve only selected metadata/evidence through repository methods. Avoid loading every historical result merely to discard it in the bridge. Profile JSON parsing/validation/redaction separately from SQLite lookup.

### 5.6 Bounded run waiting

Add a shared awaitable run observation operation and expose `runs_wait`. Extend `runs_create` with bounded `waitMs` so short runs can finish in a single model call. Start with 10 seconds default and 30 seconds maximum for the waiting form, then tune against actual client timeouts; `waitMs: 0` explicitly requests immediate return.

- Use `RunEventBroker` events rather than repeated database polls. Subscribe, read/recheck current state, then wait to avoid missing completion between lookup and subscription.
- On completion, return a compact final summary and bounded failure evidence. On deadline, return current status, `terminal: false`, and the runId needed by `runs_wait`.
- Remove listeners/timers on completion, timeout, cancellation, and host teardown. Thread request cancellation through the bridge/handler context without confusing cancel-wait with cancel-run.
- HTTP disconnect or wait timeout does not start another run or imply cancellation. Run cancellation remains explicit.
- Authorize both initial lookup and final retrieval. Keep waits bounded independently of the 10-minute host session idle timer; account for in-flight requests in idle cleanup.
- Add a caller operation ID for retriable run creation if reconnect tests demonstrate lost acknowledgments. Repository-backed deduplication must bind the ID to the same workspace and canonical request; a changed request under the same ID conflicts. Concurrent acceptance must not enqueue twice. Do not promise exactly-once remote HTTP side effects after a crash.

Optional resource refinement: coalesce intermediate updates and deliver terminal changes promptly. Use a cursor containing a broker epoch plus sequence if exposing replay/deltas; a raw sequence resets after process restart. Evicted/expired replay must explicitly require a new snapshot. Add this only if measured subscription clients benefit beyond compact summaries and waiting.

### 5.7 Assertion edits with fewer round trips

- Make `assertion_apply`'s existing canonicalization/validation clear and return compact revision/touched-node/diagnosis output.
- Keep `assertion_validate` for preview or evidence checking. Direct apply is appropriate when the user already specified the desired rules and no separate preview is required; the existing explicit approval-oriented prompt can retain its preview step.
- Extend apply with optional run evidence if needed so evidence validation and mutation can happen together against the intended source/revision. Existing apply validates syntax without a run; do not claim it already validates stored evidence.
- For suggestions, return concise candidates with stable IDs, rules and overfit warnings; verbose rationales can be optional. Do not automatically apply inferred rules merely to save a call.
- Fix evidence path correctness before relying on the faster flow: `nestedValue` currently splits only on dots (`assertion_authoring_service.ts:411–418`) while the documented path language permits `[0]`. Reuse the authoritative resolver and cover arrays, missing paths and truncated bodies.

### 5.8 Onboarding and tool inventory

- Initialize instructions: a small orientation, active-scope location, revision/patch rules, and how to obtain focused context. Do not demand full authoring guides for every existing-workflow edit.
- Briefing: session-specific IDs/name/folder and task entry point; avoid repeating all global conventions. Project sessions should use project-scoped workflow discovery.
- Guides: short edit/debug quickstart, focused authoring references, and examples tied to actual schema/analyzer behavior. Expose a bounded guide-reading tool if acceptance clients cannot make resources available to the model; it should dispatch through the registry and use the same guide source.
- Tool descriptions: concise purpose, selection guidance, side effects, essential argument pitfalls. Preserve the error-preventing edge/path rules. A concise description is not an excuse to remove critical semantics.
- Consolidate overlapping run listing/latest selectors after projections stabilize: one query operation can represent workspace/workflow/status/latest filtering. Evaluate project membership and workflow metadata overlap similarly. Remove superseded MCP tools and update guides/tests together.
- Do not set an arbitrary target such as two tools or twenty tools. Measure catalogue bytes, tool-selection error rate and task calls.
- Preserve fixed deterministic catalogue ordering; avoid per-call tool exposure changes as the default cross-client design.

### 5.9 Batching and Code Mode decision

The primary edit/debug workload benefits most from debugContext, patch and wait. General batching is lower priority.

If traces still show repeated independent reads, add one bounded read-many operation: maximum eight whitelisted read operations, bounded concurrency, shared workspace scope, per-item IDs/statuses, and one aggregate output budget. Dispatch through the same router with redaction. It must not accept arbitrary domain/action pairs, recursively invoke itself, or reach excluded secret/process/artifact operations.

Avoid a generic write batch initially. A graph patch is already a domain-specific atomic edit. If later workflows require multi-entity writes, define domain-specific transaction semantics and committed/failed outcomes; never hold SQLite transactions across async network/sync calls or claim a batch is atomic when it is not.

A native arbitrary-code execution MCP tool is deferred. It would add sandboxing, scheduling, and a new failure surface inside a desktop product. Client-side Code Mode can already compose good MCP operations where the agent harness supports it. Reconsider server-side execution only with benchmark evidence that bounded composition cannot address the dominant costs and an architecture compatible with the repository constraints.

## 6. Phased implementation backlog

Effort estimates are engineering days for implementation and focused automated checks, not elapsed calendar commitments; multi-client evaluation can extend them.

| Phase | Work | Dependencies | Estimate | Exit criteria |
| --- | --- | --- | --- | --- |
| 0 — baseline | Add reproducible catalogue/result-size harness, fixture tasks, event/call counters and client capability matrix. | None | 1–2 days | Baseline reports distinguish wire bytes, model-visible tokens, model turns, tool invocations and success. |
| 1 — compact contracts and correctness | Compact JSON encoder; one diagnosis; compact write DTOs/output schemas; safe error details; unavailable diagnosis; align conflicting guide/schema instructions. | 0 | 2–4 days | All graph-write shapes validate; no duplicate diagnosis; unavailable analysis is never clean; small-write output is bounded independently of total graph size except explicit touched/issue lists. |
| 2 — focused reads | Workflow summaries/search/pagination; outline/node/boundary reads; compact run history/summary; node evidence sections/paths/budgets; narrow repository methods. | 1 | 3–5 days | Large listings never include full graphs; targeted edits can identify required boundary edges without a full read; continuation is explicit and correct. |
| 3 — debug context | Shared debug orchestration, current graph/revision handling, run evidence and relevant environment/secret metadata. | 2 | 2–4 days | Core known-workflow failure is explainable in one bounded context read, with provenance and necessary patch inputs. |
| 4 — execution observation | Event-driven wait; create-and-wait; cancellation/deadline cleanup; retry/dedup semantics; optional notification coalescing. | 2; integrates with 3 | 2–4 days | Short runs complete in one create call; long runs yield a reusable ID; no listener leak, missed completion or duplicate enqueue on covered retries. |
| 5 — edit path and onboarding | Consolidate assertion validation/apply as appropriate; shared evidence-path semantics; topology-aware auto-layout in the service write path; concise task-specific guide/briefing. | 1–3 | 2–4 days | Config-only edits preserve layout, topology edits lay out once on the revision being saved, and assertion repair avoids redundant calls where preview is unnecessary. |
| 6 — measured surface cleanup | Consolidate overlapping tools; evaluate local schema references; add read-many only if needed; run full roster acceptance and publish before/after report. | 0–5 | 2–4 days | Meets token/call/success targets across supported clients, with obsolete MCP contracts removed. |

Recommended first implementation slice: **phase 0 + phase 1**, followed immediately by **phase 2 + phase 3** for the user's dominant workload. Each phase should leave a working end-to-end product.

### Important implementation details

- Move auto-layout into the shared revision-aware graph mutation operation. Choose `auto` behavior based on topology changes (new/removed nodes, edges, group membership/type changes), preserve positions for config/label-only changes, and retain explicit layout/preserve controls. Do not lay out redacted graph data.
- Diagnose the actual persisted revision or mark the diagnosed revision explicitly if another edit races the check. Avoid repeated service reads when a validated snapshot is already available.
- Keep existing write notifications and cloud sync behavior. MCP result projection failure after commit must not make a client reasonably infer that nothing was saved.
- Do not add raw SQL to the bridge or services. Query changes belong in repositories; measure whether new indexes are necessary rather than preemptively redesigning storage.
- Replace MCP byte-parity assertions with semantic/shared-service/redaction contract tests where compact transport DTOs intentionally differ from renderer objects.
- Keep project-export/import reference-only guarantees even if their large payloads receive resource links or paging later. This is outside the first edit/debug slice.

## 7. Evaluation and acceptance criteria

### Fixture matrix

Use isolated databases and a deterministic local HTTP fixture server:

1. 10-, 130-, and 500-node workflows; include group/note nodes and large config bodies.
2. 10- and 100-workflow workspaces, including project-attached workflows.
3. 20- and 1,000-run histories.
4. Passing negative-status tests; HTTP failure with a small structured error body.
5. Missing environment variables, unresolved secrets, missing extractor paths, failed assertions and blocked branches.
6. Several failures whose combined bodies exceed the inline output cap.
7. Stale revisions, concurrent canvas edits, and historical runs against older graphs.
8. Empty lists, no matching nodes, truncated captures, unavailable diagnosis, and denied/cross-workspace reads.
9. Immediate, 5-second, and 60-second runs; cancellation, disconnect and restart during observation.
10. Array-index assertion paths and response producers separated by delay/merge nodes.

### Representative agent tasks

- "Find the order assertion and change its expected status without disturbing the graph."
- "Explain why the latest failed run stopped and fix the missing extractor reference."
- "Insert an assertion between this request and its successor."
- "Check whether this 409 is the expected result or an actual failure."
- "Run this workflow and summarize failures when it finishes."
- "Find the project workflow by name, inspect the failing branch, and patch one request field."
- "Recover from a revision conflict while preserving the user's concurrent edit."

Score resulting graph and explanation correctness, not one prescribed sequence of tool names. Keep held-out task variants. Run repeated trials for nondeterministic agent behavior and record exact client/model versions.

### Measurements

- Discovery: catalogue bytes; input/output schema bytes; model-visible tool-definition tokens where observable; time to list tools.
- Per task: model turns, tool calls, resource reads, polls, errors/retries, input/output/cached tokens when available, wall time and success.
- Per response: text bytes, structured bytes, total serialized result bytes, truncation/continuation and actual model-visible content.
- Server: SQLite/JSON parse time, authorization, analysis, redaction, schema validation, serialization, event-loop delay, active listeners and peak memory.
- Report cold onboarding separately from warm tasks; record resource support and eager/lazy discovery. Never count server-internal dispatches as model round trips.
- Server-only measurements cannot recover provider billing or prove that structured/text results were both put in context. Obtain those from client traces where available; otherwise label them unobserved.
- Local metrics should contain tool name, shape, byte counts, duration and status, not raw payloads or credentials. Fixture transcript capture can be detailed because its data is synthetic.

### Initial targets — hypotheses, to ratify after phase 0

Phase 0 shipped, and it ratified none of these. The harness (`app/core/mcp/harness/`) measures the catalogue and the fixture payload sizes for real, but it has no trial driver: `McpBenchmarkRecorder`, `createMcpBenchmarkDatabase`, the local HTTP fixture server and `createBuiltinClientCapabilityMatrix` are exercised only by `app/core/mcp/__tests__/baseline-harness.test.ts`, and every capability cell that matrix emits is the constant `"unverified"`. No model turns, tool calls, token counts or task-success figures have been recorded for any client. Only the first row below has a measured counterpart — the catalogue measurement that follows the table — and every other row is still a hypothesis to which no number should be attributed.

| Metric | Proposed target |
| --- | --- |
| Full catalogue wire bytes | At least 50% reduction from 527,748 without weaker validation |
| Default graph-free list/writes | At least 80% response-text reduction on large fixtures that currently echo graphs |
| Small clean patch response | At most 2 KiB logical JSON; one diagnosis and retained rev/touched IDs |
| Default general read/context response | At most 32 KiB logical inline JSON, with explicit continuation |
| Warm existing-workflow edit/debug task tokens | At least 40% reduction on weighted benchmark tasks |
| Median model tool rounds | At least 30% reduction on the edit/debug suite |
| Known-workflow debug lookup | One context call plus optional targeted body detail |
| Run completing within requested wait | One create-and-wait call, no agent poll loop |
| Task success | No meaningful regression versus baseline; investigate uncertainty with repeated/paired trials |
| Data correctness | No false-clean diagnosis, missing-boundary edits, truncated-as-complete payloads or stale-write clobbers |
| Redaction/exclusions | All existing guarantees hold for every new projection, aggregate and continuation |

**Measured catalogue result after phases 0–6.** The same catalogue probe, re-run on branch `mcp-optimizations` (working tree, 2026-09-10):

```bash
./app/node_modules/.bin/tsx --tsconfig app/tsconfig.desktop.json docs/.scratch/mcp-audit-measure.ts
```

| Catalogue measurement | Baseline | Measured | Change |
| --- | ---: | ---: | ---: |
| Entire `tools/list` result | 527,748 (55 tools) | 256,703 (54 tools) | -51.4% |
| Sum of input schemas | 100,392 | 104,146 | +3.7% |
| Sum of output schemas | 407,177 | 128,002 | -68.6% |
| Sum of tool descriptions | 7,962 | 12,595 | +58.2% |

Output schemas fell from approximately 77.2% of the catalogue to approximately 49.9%. Input schemas and descriptions both grew, which is the intended trade: validation was not weakened to reach the byte target, and descriptions absorbed the selection guidance §5.8 asks for. This is a measured result for the first row of the table above and nothing else — the “at least 50% reduction” catalogue target is met on this measurement. The token, round, response-budget and success targets have not been measured at all, and this number must not be read across to them.

Byte-budget definitions must be explicit: logical inline JSON, wire JSON including repeated text/structured forms, and model-visible tokens are different metrics. Do not report their percentages interchangeably.

### Built-in agent coverage

Based on the checked-in roster, not a claim of live verification of every CLI today:

| Group | Agents | Acceptance approach |
| --- | --- | --- |
| Per-launch MCP wiring declared | Claude Code, Codex CLI, Gemini CLI, OpenCode, GitHub Copilot CLI, Qwen Code | Connect, discover, read focused context, patch with revision, inspect compact errors, create/wait, and verify model-visible results. |
| Manual MCP setup declared | Cursor Agent, Crush | Test equivalent MCP operations using documented manual configuration; do not assume per-launch setup exists. |
| No built-in MCP in roster documentation | Aider, Pi | Verify truthful no-MCP briefing; optimization cannot give these clients native MCP support. Third-party adapters are a separate scope. |

For each MCP-capable client record: tested version, connection success, resource reading, server-instruction visibility, tool-list handling, local `$ref` support, result-channel handling, timeout/cancel behavior and tool-search behavior. Mark unavailable tests unverified rather than passing. Use a few clients for repeated deep task evaluations, plus cross-roster smoke/contract checks.

The matrix is roster-derived: `createBuiltinClientCapabilityMatrix` classifies every key in `BUILTIN_AGENTS` and throws `Unclassified built-in agent in MCP capability matrix` on any key it does not know. Adding a built-in agent therefore breaks `npm run mcp:baseline` until that switch is updated.

### Required implementation checks

For each implementation phase run repository-required checks from `app/`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:app`, and `npm run build`. Add focused desktop/MCP tests for changed behavior, and an installed/dev-app MCP smoke test for the final surface. Run `graphify update .` after code changes. Packaging or native additions need the project's native rebuild/asar rules.

Implementation status: phases 0–6 are implemented on branch `mcp-optimizations`, and the catalogue and synthetic projection probes were executed successfully both before and after. What was **not** done: no real agent benchmark exists. The phase-0 harness has no trial driver — its recorder, isolated database, HTTP fixture server and client capability matrix are reached only by their own test — so no model turns, tool calls, token counts or task-success figures have been recorded for any client, and every per-task target in this section remains a hypothesis. A full roster acceptance pass, a full test suite run and an installer build are likewise not recorded as having been performed for this plan.

The required AST graph refresh completed after adding the scratch probe. It reported incomplete coverage: 31 files produced no nodes and 16 SQL files were skipped because `tree_sitter_sql` is unavailable; community labels also need refresh. The 7,080-node graph was rendered as an aggregated community view. These limitations do not invalidate the direct source inspection or SDK measurements above. `git diff --check` also passed for tracked changes.

## 8. Decisions to defer until measurements justify them

- Exact page/body budgets and wait defaults: tune against fixture outcomes and actual client timeout behavior.
- Schema-reference conversion: use supported library features only, after compact DTOs reveal the remaining need and client support is known.
- Text-only versus text+structured delivery: compact both initially; no claimed model-token savings from removing a channel without traces.
- Read-many and notification deltas: add only where compound context and bounded wait leave demonstrable repeated calls.
- Generic write batching, arbitrary Code Mode execution, SDK major-version migration, server-side LLM summaries and custom binary/text encodings: not prerequisites for the recommended architecture.

The main product questions have been answered. Remaining uncertainties are technical measurements that phase 0 can resolve rather than blockers requiring more user decisions.
