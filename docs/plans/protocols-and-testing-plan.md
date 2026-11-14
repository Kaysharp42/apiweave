# Protocols and testing expansion plan

## Status

| Task | Branch | State |
| --- | --- | --- |
| A: WebSocket + stream-listener seam | `feat/websocket-node` | **Done**, merged `6dcf18a9` |
| B: JSONPath | `feat/jsonpath` | **Done**, merged `bb4ffec9` |
| C1: gRPC unary, reflection, discovery | `feat/grpc-node` | **Done**, merged `d5da4c17` |
| C2: gRPC server streaming | `feat/grpc-streaming` | **Done**, merged `99169e4a` |
| D: SOAP/XML, XPath, WSDL import | `feat/soap-xpath` | **Done**, merged `d7af6f3c` |
| F: JSON-RPC 2.0 | `feat/jsonrpc-body` | **Done**, merged `5850f208` |
| H: Contract checks | `feat/contract-checks` | **Done**, merged `12af8322` |
| I: For-each | `feat/for-each` | **Done**, merged `6a204832` |
| J: Load runs | `feat/load-runs` | **Done**, merged `b5945ab3` |
| E: Message queues | `feat/message-queues` | **Not started**; only the schema scaffolding exists (`wip(proto-mq)`), no runner, nodes or tests |
| G: Snapshot testing | direct on `main` | **Done** |

`main` after the nine merges: typecheck, lint, `build:app` and `build:cli` pass, and the full suite is 4458 passed, 3 skipped.

This plan adds WebSocket, gRPC, JSON-RPC, SOAP/XML and message queue support, and five testing features: JSONPath, for-each, snapshot testing, contract checks and load runs.

Each task is built by its own agent, on its own branch, in its own git worktree. Agents never push. The branches are merged into `main` locally, one at a time, in the order below.

## Dependency graph

```
Phase 1 (parallel, no shared prerequisites)
  A  WebSocket node + stream-listener seam ──┬──► C2  gRPC server streaming
                                             └──► E   Message queues (publish + consume)
  B  JSONPath in the path resolver ──────────┬──► D   SOAP/XML, XPath, WSDL import
                                             └──► G   Snapshot testing
  C1 gRPC node: proto import, reflection, unary calls ──► C2
  F  JSON-RPC 2.0 body type
  H  Contract checks against imported OpenAPI schemas
  I  For-each: Call Workflow over a list
  J  Load runs: parallel iterations + latency percentiles

Phase 2 (each starts once its prerequisites are merged into main)
  C2 after A and C1
  E  after A
  D  after B
  G  after B
```

### Why these are the dependencies

- **A → C2, E.** SSE is the only streaming node today, and its two-phase lifecycle is SSE-specific code in the executor: `startSseListener`, `consumeSseListener`, `completeSseNode`, `sseEventMatches`, `traverseSseCompleteEdges`, `abortSseListeners` and `waitForSseTasks` in `app/core/runner/executor.ts`. That lifecycle is a Ready output after the handshake, a background consumer, and a Complete output when a finish rule, event limit or timeout closes it. WebSocket, gRPC server streaming and MQ consume all need the same lifecycle. A generalizes it into one protocol-neutral seam, with SSE and WebSocket as its first two users, so the later nodes plug in instead of copying it three more times.
- **B → D, G.** `resolveExtractorPath` (`app/shared/extractors/extractorPath.ts`) is the single path resolver shared by extractors, assertions, finish rules and the renderer's preview. B gives it a grammar dispatch: dot paths stay as they are, and `$`-prefixed paths are JSONPath. D adds XPath as a third branch of that dispatch. G uses JSONPath for snapshot ignore paths, for example `$..updatedAt`.
- **C1 → C2.** C2 extends the gRPC node that C1 builds.
- **Everything else is independent in code.** It only conflicts textually in shared lists, which the merge order handles.

## Merge order and conflict hot spots

Merge order: **B, A, F, H, I, J, C1**. Then, as Phase 2 finishes: **D, G, C2, E**.

Merging B and A first means every later branch rebases onto the seams it may want to use. A branch is rebased onto `main` before it is merged.

These files are edited by several tasks. The conflicts there are additive and are resolved by keeping both sides:

- `app/shared/zod-schemas/WorkflowNodeTypeSchema.ts` and `WorkflowNodeSchema.ts`: new node types (A, C1, E)
- `app/core/runner/executor.ts`: the `executeNode` dispatch and `traverseFromNode` (A, C1, E, H, I)
- `app/shared/zod-schemas/HTTPNodeDataSchema.ts`: the `bodyType` enum (F, D) and contract settings (H)
- `app/src/components/node-modal/HTTPRequestConfigPanel.tsx` (F, D, H)
- `app/core/runner/reporters.ts` (J, G)
- the node registries listed under [Adding a node type](#adding-a-node-type)
- `app/package.json` and `package-lock.json`: new dependencies (A–E, B). Regenerate the lock file with `npm install` after resolving `package.json`; never hand-merge the lock file.

## Rules that apply to every task

These rules come from `AGENTS.md` and `apiweave-context.md`, and every agent reads both first.

- TypeScript strict, and no `any`. Shared types go one per file under `app/shared/types/`, defined as `z.infer` of a schema in `app/shared/zod-schemas/`. Renderer types go one per file under `app/src/types/`. Both are exported through `index.ts`.
- No backward compatibility: remove or rename obsolete paths outright.
- New dependencies must be pure JavaScript, or N-API with prebuilds. Nothing V8-ABI. Anything that loads a worker or binary from `__dirname` goes into `build.asarUnpack`.
- Code in `app/core/runner/` and `app/core/services/` must stay Electron-free, because `apiweave run` bundles it and the CLI build fails on any `electron` import.
- Secrets are referenced as `{{secrets.*}}` and never appear in exports, read APIs or stored results. The run's secret masker must cover every new protocol's request and response capture.
- Network settings (proxy, CA, client certificates, `sslVerify`) apply to every new protocol where the protocol allows it. Read `app/core/runner/network.ts` and `docs/features/network.md`.
- Every capture is bounded: byte limits and message counts, like `SSE_MAX_CAPTURE_BYTES`.
- Use the existing UI components (`Button`, `Panel`, `FormField` and so on). No raw HTML styled with Tailwind.
- Add a new MCP tool only by adding it to `app/core/mcp/tools.ts`. The node *schemas* reach agents automatically through `workflows.nodeSchema`. Update `app/core/mcp/guide.ts` only if a new node needs authoring guidance.
- Docs: update `docs/features/workflows-and-nodes.md` or the relevant feature doc, update `docs/reference/known-limitations.md` when a limit is lifted, and add an entry under `## [Unreleased]` in `CHANGELOG.md`, creating that heading if it is missing.
- Tests: unit tests next to the code in `__tests__/`. A new protocol is tested against a real local server started in the test (`ws` server, `@grpc/grpc-js` server, an in-process HTTP server for SOAP and JSON-RPC). The broker clients are tested with mocked clients, plus an integration test that is skipped unless the broker's environment variable is set.
- Before handing back, these must all pass in `app/`: `npm test`, `npm run typecheck`, `npm run lint` and `npm run build:app`.
- Commit with conventional commits on the task's branch. Never push, never touch `main`, and never commit `docs/.scratch/`.

## Adding a node type

The SSE node is the reference for adding a node type. `grep -rlI "SseNodeData\|\"sse\"\|'sse'" app --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release` lists every place a node type is registered:

- **Shared:** `shared/zod-schemas/WorkflowNodeTypeSchema.ts`, `WorkflowNodeSchema.ts`, `NodePresetNodeTypeSchema.ts`, `NodePresetSchema.ts` and `<X>NodeDataSchema.ts`, plus the matching `shared/types`.
- **Analysis:** `shared/analysis/workflow_graph_analyzer.ts`, for variable provenance from extractors.
- **Runner:** `core/runner/executor.ts`, and `core/runner/<protocol>.ts` for the protocol code.
- **Services:** `core/services/node_facts.ts`, `workflow_reads.ts` and `assertion_authoring_service.ts`.
- **Renderer:**
  - `src/components/nodes/<X>Node.tsx` and `nodes/index.ts`
  - `src/components/node-modal/<X>ConfigPanel.tsx`, `NodeModal.tsx` and `NodeModalHeader.tsx`
  - `src/components/WorkflowCanvas.tsx` and `WorkflowJsonEditor.tsx`
  - `src/hooks/useCanvasDrop.ts` and `useNodePaletteSections.ts`
  - `src/utils/nodePresets.ts` and `src/commands/registry.ts`
  - `src/types/NodeModalNodeType.ts`, `<X>NodeData.ts` and `<X>NodeProps.ts`

---

## A — WebSocket node and the stream-listener seam

**Goal.** Add a `websocket` node that opens a connection, sends messages, collects incoming ones, and closes on finish rules, a message limit or a timeout. Like SSE, it has **Ready** and **Complete** outputs. To support it, turn SSE's executor lifecycle into a protocol-neutral stream-listener seam with two users, SSE and WebSocket.

**Seam.** Replace the SSE-specific executor methods with one lifecycle that drives a protocol adapter. The adapter's contract is:

1. Open and handshake. This resolves when the stream is ready, which fires the Ready output, or rejects, which fails the node.
2. Expose an async iterator of messages normalized to a JSON-able record, such as `{ event, data, id }` for SSE and `{ type: "text" | "binary", data }` for WebSocket. `data` is parsed as JSON when possible, exactly as SSE does today.
3. Close.

Finish conditions become one schema used by every stream node, `StreamFinishCondition` (renamed from `SseFinishCondition`). They are evaluated by one function against the normalized record, using `resolveExtractorPath`. The message limit, byte cap, timeout and capture-and-displace rule for the terminal event become shared code. Pick the module layout that keeps `executor.ts` smaller, for example `core/runner/stream_listener.ts` plus a `core/runner/streams/{sse,websocket}.ts` per protocol. The handle-routing check in `traverseFromNode` (`node.type === "sse"`) becomes a check for "is a stream node".

**WebSocket config:**

- `url` (`ws://` or `wss://`) and `queryParams`
- `headers` and `auth`, where auth uses the handshake headers
- `subprotocols`
- `messages`: an ordered list of `{ data, type: text|binary(base64), delayMs? }` sent after the handshake. Placeholders are substituted.
- `timeout`, `maxMessages` and `finishConditions`, each with the same rules as SSE
- `sslVerify`, `continueOnFail` and `extractors`

The result exposes `response.body.messages[]`, `response.body.messageCount`, `response.body.termination`, `response.body.closeCode`, `response.body.closeReason` and `response.duration`.

**Library.** Use undici's `WebSocket`, which undici already ships, with a `dispatcher` from `network.ts` so that proxy, CA and mTLS settings apply. Check undici 7's types for the `headers` and `dispatcher` options before adding anything. Use the `ws` package only as a dev dependency, for the test server.

**Out of scope:** interactive or long-lived sessions, which are not test probes.

## B — JSONPath in the path resolver

**Goal.** A path beginning with `$` is evaluated as RFC 9535 JSONPath. Every other path keeps the current dot grammar.

`resolveExtractorPath` is the single entry point and must be the only one. Today, extractor paths are rooted at the node result, so `response.body.x`. JSONPath is rooted the same way: `$.response.body.items[?@.id==3].name`. If the existing `path`/`source` model makes another rooting more natural, decide that and document it. The rule is the same everywhere: extractors, Assertion rules, stream finish conditions and the renderer's extractor preview.

**Semantics:**

- A query that matches nothing is `path-missing`.
- A query that is singular by RFC 9535 returns the value.
- A non-singular query returns an array of every match, so `count` and `contains` work on it.
- An invalid expression is a distinct failure reason, `invalid-path`, which is surfaced in validation (`isValidRuntimePath` in `shared/analysis/workflow_graph_analyzer.ts`) and in the UI.

**Library.** Use a maintained RFC 9535 implementation that does not use `eval` or `Function`. Check whether `jsonpath-plus` in safe mode meets RFC 9535 before choosing it; prefer a dedicated RFC 9535 package. The library must work in both the renderer and Node.

Update the variable-provenance analysis, the assertion authoring service and the evidence reads so a JSONPath extractor is understood everywhere a dot path is. Document the grammar in `docs/features/variables-and-extractors.md`.

**Hook for D.** Keep the grammar dispatch in one small function. D adds XPath to it.

## C1 — gRPC node: proto import, reflection, unary calls

**Goal.** Add a `grpc` node that calls a unary method.

**Config:**

- `target` (`host:port`) and `tls`, which uses the network settings for the CA, client certificate and `sslVerify`
- `service` and `method`
- `message`: a JSON template with placeholders
- `metadata` (key/value pairs) and `auth`, where bearer and API key become metadata
- `deadline` (seconds)
- `schemaSource`: either `reflection` or `proto`. A `proto` source holds the `.proto` text and its imports *inside the workflow*, as a map from path to content, so the workflow stays portable in `.aweproject` exports and git.
- `continueOnFail`, `extractors` and `expectedStatus`, a gRPC status code name

The result exposes:

- `response.body`: the decoded message as JSON, with longs as strings and enums as names
- `response.status`: the gRPC code name
- `response.statusCode`: the gRPC code number
- `response.statusMessage`
- `response.headers`: initial metadata
- `response.trailers`
- `response.duration`

A non-OK status fails the node unless it equals `expectedStatus`, mirroring the HTTP node's expected status for negative tests.

**Libraries.** Use `@grpc/grpc-js` and `@grpc/proto-loader`, both pure JavaScript. For reflection, find a maintained client that supports both `grpc.reflection.v1` and `v1alpha`. If none exists, implement the client against the reflection proto with grpc-js. Make sure the reflection protos and proto-loader's bundled Google protos survive the esbuild bundle and the asar packaging.

**UI.** In the config panel, the user enters a target and either runs **Discover** (reflection) or picks proto files. They then choose a service and method from dropdowns, and a message skeleton is generated from the input type.

**Discovery IPC.** Discovery runs through a new handler domain, `core/ipc/handlers/grpc.ts`, registered in `handlers/index.ts`. Add it to the MCP whitelist in `core/mcp/tools.ts` as read-only, because agents authoring gRPC nodes need it.

**Hand-off to C2.** Shape the code so the streaming kinds are an extension of this node, not a rewrite. Keep a `callType` field and accept only `unary` for now.

## C2 — gRPC server streaming (after A and C1)

Add `callType: "server-streaming"`. Such a node is a stream node that uses A's seam: Ready fires once the call is accepted and initial metadata arrives, the messages are the decoded responses, and the finish conditions, message limit and timeout behave as on every other stream node. The final status and trailers are part of the result.

Client streaming and bidirectional streaming are out of scope. Add them to `known-limitations.md`.

## D — SOAP/XML, XPath and WSDL import (after B)

- **Body.** Add a `soap` body type to the HTTP node with `version: "1.1" | "1.2"`, `action` and `envelope`, an XML template. Send the correct `Content-Type` and `SOAPAction` for the version, `text/xml` for 1.1 and `application/soap+xml; action=` for 1.2. A raw `xml` body type is also worth adding if `raw` does not already set the content type.
- **Parsing.** XML and SOAP responses keep `response.body` as the raw string, and also get `response.xml`, a parsed document available to XPath. Use whatever representation the XPath library needs and keep it out of stored results.
- **XPath.** Add a third branch to B's grammar dispatch: paths beginning with `xpath:` are evaluated as XPath 1.0 against `response.xml`, for example `xpath://*[local-name()='Total']/text()`. Namespace handling must work, including a way to declare prefixes or a `local-name()` fallback. A SOAP Fault fails the node unless the expected status says otherwise.
- **Libraries.** Use `@xmldom/xmldom` and `xpath`, both pure JavaScript and maintained. Disable external entity and DTD processing to block XXE.
- **WSDL import.** Add a WSDL 1.1 import alongside OpenAPI in `core/services/import_parsers.ts`: one HTTP node per operation, with a SOAP envelope skeleton generated from the schema types. Inline `xsd` only. External imports and includes are listed as a limitation, the same way OpenAPI handles external `$ref`.

## E — Message queues (after A)

Add two node types, `mq-publish` and `mq-consume`. Each has a `broker` discriminant (`kafka`, `mqtt` or `amqp`) and a per-broker connection config. Credentials are supplied only through `{{secrets.*}}`. TLS uses the network settings.

- **`mq-publish`.** A one-shot node: `key`, `headers` or properties, `payload` (a template), and the broker-specific destination (a topic, a topic plus QoS and retain, or an exchange plus routing key). The result is the broker's acknowledgement: partition and offset, packet ID, or confirm.
- **`mq-consume`.** A stream node that uses A's seam: subscribe, fire Ready once subscribed, collect messages, and close on finish conditions, the message limit or the timeout. For Kafka, use a throwaway consumer group with `fromBeginning: false` by default, so that "publish, then consume, then assert" works in one workflow: the Ready output fires before the publish runs.
- **Libraries.** Use `kafkajs`, `mqtt` and `amqplib`, all pure JavaScript. Check each library's maintenance status first, and prefer a maintained fork if one is the de facto successor.
- **Cleanup.** Every connection closes when the node finishes and when the run is cancelled. Nothing may keep the CLI process alive after a run.

## F — JSON-RPC 2.0 body type

Add `bodyType: "jsonrpc"` with `jsonrpc: { method, params (JSON template), notification?: boolean }`. It is POSTed as `application/json` `{"jsonrpc":"2.0","method","params","id"}`, with an `id` that increases per request within the run. Notifications omit the `id`.

A response with an `error` member fails the node unless `continueOnFail` is set, or unless the user opts out with `allowRpcError`. The error code and message appear in the failure message. Batch requests are out of scope.

## G — Snapshot testing (after B)

Add an Assertion operator `matchesSnapshot` and a snapshot store.

- **Storage.** A baseline is a JSON file stored *with the workflow*, so that it is versioned in the workspace's git checkout. Investigate how workflows are persisted to disk (`core/repositories`, `core/git` and the workspace file layout) and put snapshots beside them, keyed by workflow ID, node ID and rule index. If workflows are not files on disk, store the baseline in SQLite through a repository, and include it in `.aweproject` exports.
- **Ignore paths.** Each rule has `ignorePaths`, a list of JSONPath expressions from B, such as `$..id` and `$..createdAt`. Matching values are replaced with a placeholder before comparing.
- **First run.** With no baseline, the rule passes and records the baseline. The run report says so.
- **Mismatch.** The rule fails with a structural diff.
- **Approval.** An **Accept new snapshot** action in the run inspector overwrites the baseline. It is a privileged write only in the sense that it is user-initiated: put it on the router, but do not expose it through MCP. The CLI gets an `--update-snapshots` flag.
- **Reports.** The diff appears in the HTML report.

## H — Contract checks

The HTTP node already stores per-status `responseSchemas` from OpenAPI. Add a per-node `contract: "off" | "warn" | "fail"`. It defaults to `fail` when the node has OpenAPI metadata (`OpenApiNodeMeta`) and to `off` otherwise.

When the check is on, validate every response against the schema for its status, falling back to `default`. A status the spec does not declare is itself a contract violation. Under `warn`, violations are recorded and shown, but the node does not fail. Reuse `core/runner/json_schema.ts` and the existing `SchemaViolation` type.

Add a CLI flag `--contract <off|warn|fail>` to override the setting for a whole run. The HTML and JUnit reports list the violations. Check how `responseSchemas` validation already runs today, and fold it into this instead of adding a second path.

## I — For-each: Call Workflow over a list

Loops stay acyclic. Extend the Call Workflow node with an optional `forEach`:

- `items`: a placeholder or path that resolves to an array
- `itemVariable` and `indexVariable`, mapped into the child's inputs
- `concurrency`: an integer from 1 to 16, default 1
- `stopOnFailure`: a boolean

The child workflow runs once per item. The node passes if every iteration passes, or with `stopOnFailure: false`, it completes and reports how many iterations failed. Output mapping collects each output variable into an array, in item order.

Cap the iteration count (for example at 1000) and keep the existing nesting limit of 8. The run inspector shows the iterations as children of the node. Read how `executeCallWorkflow` records child runs and reuse that.

Update `known-limitations.md`.

## J — Load runs

Add a load mode on top of data-driven iterations (`core/runner/iterations.ts`): `--iterations N` or a data file, plus `--concurrency C` (iterations in flight at once) and an optional `--duration` and `--ramp-up`. Read the scheduler (`core/runner/scheduler.ts`) and its concurrency cap first.

The run summary records, per node, the count, error rate and latency min/mean/p50/p90/p95/p99/max, plus the throughput. The HTML report adds a latency table. The desktop app gets a **Load** run option with the same settings.

Load mode never retains full response bodies for every iteration. Keep the first failure per node and aggregate statistics only.

Thresholds turn the run into a gate for CI: `--threshold "p95<500"` and `--threshold "errors<1%"`. A breached threshold exits 1.
