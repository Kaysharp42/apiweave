# MCP field feedback plan

Tracker for the problems agents reported while building browser and API test
suites over the MCP server. The process is in
[`mcp-field-feedback-loop.md`](mcp-field-feedback-loop.md). Everything here is
written generically: no application under test, host, record or label is named.

## Status

| Batch | Title | IDs | Model | Branch | State |
| --- | --- | --- | --- | --- | --- |
| B1 | Edge integrity on every write | FB-001…FB-005 | DeepSeek Flash (impl), coordinator (review) | `fb-b1` → merged | done (`234a5e5f`…`998b3644`) |
| B2 | Call Workflow data passing fails loudly and keeps types | FB-010…FB-016 | Opus 5.5 | `fb-b2` → merged | done (`b62e7bc6`, `f3061696`) |
| B3 | One placeholder path walker; analyzer sees scripts and nested reads | FB-017, FB-018 | Opus 5.5 | `fb-b3` → merged | done (`e2a8b1b0`, `fe1ef160`) |
| B4 | Browser actions verify what they did | FB-030…FB-036 | Sonnet 5.5 | `fb-b4` → merged | done (`5942a4b9`) |
| B5 | Evidence and inspection tell the truth | FB-040…FB-045 | GLM-5.3 | `fb-b5` → merged | done (`9813336e`…`942c4de3`) |
| B6 | MCP surface and guides | FB-050…FB-061 | Sonnet 5.5 | `fb-b6` → merged | done (`049ae209`…`05ff7e5c`) |
| B7 | The open canvas stops bumping `rev` | FB-006 | Opus 5.5 | `fb-b7` → merged | done (`863017d7`) |
| B8 | Read a run's final variables | FB-019 | Opus 5.5 (design), GLM-5.3 (impl) | merged | done (`52da71a4`…`f898b51d`) |
| — | Deferred features | FB-070…FB-075 | — | — | needs decision |

Round 1: notes as of 2026-11-26, triaged by four subagents (Opus 5.5, Sonnet 5.5,
GLM-5.3, DeepSeek Flash), key `file:line` claims re-checked by the coordinator.

Verdicts: **bug** (wrong behaviour), **gap** (works as designed, but an agent
cannot learn the rule from the schema, error or guide), **feature** (missing
capability), **works** (already correct; the note is stale or misread),
**external** (the application under test or the network, not APIWeave).

Paths are under `app/`.

## Decisions (made by the user, 2026-11-26)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Evidence URLs: keep cutting the whole query string, or redact per parameter with the existing key-aware redactor? | **Per parameter.** The redaction guide already promises it (FB-040). |
| D2 | An inspected page: consumed on first read, or re-readable until it expires (10 min)? | **Re-readable until expiry** (FB-042). |
| D3 | Expose a run's final variables over MCP? They are stored sanitised by key name; values must also be masked against the run's secret values. | **Yes**, as a section of the run read, after the masking check (FB-019). |
| D4 | Add `force` to `click`/`check`? | **Not yet.** Better error hint and guide first (FB-035); revisit if agents still stall. |
| D5 | Serialise browser runs (a scheduler lane) so two runs sharing a login don't collide? | **Document only**; a lane is over-strict across different target apps (FB-060, FB-073). |

---

## B1 — Edge integrity on every write

One validation in `WorkflowService` (`create`, `update`, `patch`): every edge the
caller sends has both endpoints in the resulting graph, no two edges share an
`edgeId`, and no two share `(source, target, sourceHandle, targetHandle)`.
Rejected with a `ValidationError` naming the edge; nothing is written. The
implicit drop of *stored* edges incident to a removed node stays (documented
behaviour).

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-001 | An edge upserted to a node that does not exist is silently dropped. | bug | `mergeGraphPatch` filters edges with a missing endpoint (`core/services/workflow_service.ts:143-149`); `touchedEdgeIds` is computed from the request, so it still names the dropped edge (`core/mcp/projections/workflow-write.ts:98-105`). `create` does not filter at all (`workflow_service.ts:280-295`). | Reject explicitly sent edges whose endpoints are absent, on all three write paths. | S |
| FB-002 | A patch that removes a node and re-sends an edge touching it "leaves a dangling edge". | bug (misdiagnosed) | Same as FB-001: the edge is dropped, not stored; the agent saw the broken chain (`unreachable_nodes`), not a `dangling_edge`. | Same validation; error names the edge and the node removed in this patch. Replace-in-place (remove + upsert the same id) keeps working. | S |
| FB-003 | Duplicate edges (same endpoints, new `edgeId`) pile up; diagnosis says nothing. | bug, **severe** | Merge dedupes by id only (`workflow_service.ts:139,253-269`); the analyzer collapses parallel edges into sets (`shared/analysis/workflow_graph_analyzer.ts:134-173`). The executor takes the branching path when `nextEdges.length > 1` and runs the target **once per duplicate**, concurrently (`core/runner/executor.ts:1034-1048`): doubled side effects. | Reject at write time; add a `duplicate_edge` error diagnostic + guide row + `remove_duplicate_edge` remediation for graphs already stored; dedupe the canvas assertion-branch `onConnect` (`src/components/WorkflowCanvas.tsx:1347-1359`). | M |
| FB-004 | Reusing an `edgeId` rewires that edge. | gap | Documented upsert-by-id (`core/ipc/handlers/workflows.ts:126-130`), but nothing says a colliding id replaces the endpoints. | One sentence in the `upsertEdges` description and the workflow-authoring guide; a test pinning the contract. | S |
| FB-005 | A chain edited over many patches is hard to verify. | gap | — | Guide: a single browser chain has `nodes − 1` edges; read the outline back after removing nodes. Mostly obsoleted by FB-001…003. | S |

Tests: `core/services/__tests__/workflow_patch_validation.test.ts`,
`shared/.../workflow_graph_analyzer.test.ts`, `core/mcp/__tests__/mcp.test.ts`,
`core/mcp/__tests__/diagnostic-codes.test.ts`.

## B2 — Call Workflow data passing fails loudly and keeps types

Root cause shared by most of the section "passing data into a called
workflow": `resolveInputVariables` (`core/runner/executor.ts:3143-3149`) turns
every mapping into text through `substituteVariables`, which returns an
unresolved placeholder **unchanged** (`executor.ts:3366`). The child receives
literal `{{variables.x}}` text and fails later with a vague "a placeholder
could not be resolved" (`core/runner/browser/step.ts:62-66`), so it looks as if
the mapping never arrived.

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-010 | An `inputMapping` value that does not resolve in the caller reaches the child as literal text. | bug | Above. | Fail the Call Workflow node at the call site: `inputMapping.<key>: {{…}} is not set in the caller`. | M |
| FB-011 | `forEach` ignores `inputMapping`. | works (misdiagnosed) | The mapping is merged into every iteration (`executor.ts:2985,2998`); the observed symptom is FB-010. | Test `forEach` + `inputMapping` (none exists in `executor_for_each.test.ts`). | S |
| FB-012 | Nested fields of a `forEach` object item do not resolve. | works (likely misdiagnosed) | Items keep raw values (`executor.ts:2999,3156-3182`) and the resolver walks object keys. The symptom matches FB-013. | Test an object item read as `{{variables.case.title}}`. | S |
| FB-013 | `inputMapping` cannot pass objects. | bug | `placeholderText` JSON-stringifies (`executor.ts:290-292`); the child walks into a string. A non-string literal in the mapping is rejected by the schema (`shared/zod-schemas/WorkflowCallNodeDataSchema.ts:35-36`) — that error was returned, not silent. | A mapping value that is exactly one `{{…}}` passes the raw value (as `resolveItems` already does); mixed templates stay text. Update schema description and guide (`core/mcp/guide.ts:393`). | S–M |
| FB-014 | A script-set runtime variable stays literal in `inputMapping`. | works (not reproduced) | `aw.variables.set` writes the same map the mapping reads (`executor.ts:1759`, `core/runner/script_sandbox.ts:309-312`). Likely set in another scope (a child without `outputMapping`, or a non-upstream branch); FB-010 turns it into a clear error. | Test: script sets `x`, downstream call maps it, child receives it. | S |
| FB-015 | An unresolved placeholder in a `fill` value becomes "" and the step passes. | works / gap | `fill` already fails on a leftover placeholder (`step.ts:73-87,301`). A value that *resolves* to `""` passes, and `fill` records nothing about what it typed (`step.ts:316-317`). | Record the typed value (masked) as `actual` in fill evidence. Needs a repro if the original symptom persists. | S |
| FB-016 | Child variables are invisible to the parent without `outputMapping`. | gap | By design (`executor.ts:2871-2875,3103`); the guide still says calls run "inline… no separate run history entry" (`guide.ts:391`), contradicted at `:419`. | Rewrite the guide paragraph: isolation in both directions, own child run, how to map out. | S |

Tests: `core/runner/__tests__/executor_for_each.test.ts`, the Call Workflow executor tests.

## B3 — One placeholder path walker; analyzer sees scripts and nested reads

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-017 | Array indexes in placeholders (`{{variables.arr[0]}}`) stay literal. | bug | Scoped resolution splits on `.` only (`executor.ts:3201-3204,3362-3365`); node-result paths support `[n]` (`:3209,3401`) — four near-copies of the path walker. `shared/extractors/extractorPath.ts:158` already handles `key[n]`. The analyzer, node facts and URL preview regexes (`workflow_graph_analyzer.ts:19`, `core/services/node_facts.ts:24`, `core/runner/scheduler.ts:978`) see neither `[n]` nor dotted names. | Route all walkers through the shared dot-path resolver; regexes capture the root name plus an optional path. | M |
| FB-018 | Variables written by `aw.variables.set` are flagged `variable_source_missing`. | bug (false positive) | The analyzer's producers are extractors, browser `extract` and `outputMapping` only (`workflow_graph_analyzer.ts:93-106,898-909`); `node_facts.ts:28` and `core/runner/resume.ts:110-111` each parse script writes their own way. | One shared producer/consumer extractor in `shared/`, used by all three. A child reading its `forEach` item or `inputMapping` key must not be flagged either. | M |

Order: B2 then B3 (B3's resolver also serves FB-013's nested reads).

## B4 — Browser actions verify what they did

Code: `core/runner/browser/step.ts`, `locator.ts`, `shared/zod-schemas/Browser{NodeData,Locator}Schema.ts`.

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-030 | `expect-value` has no `match`. | gap | Strict equality on `inputValue()` (`step.ts:367-381`); no field in the schema. | Add `match` (default `equals` for this action) through the existing `compareText`; renderer form (`src/utils/browserStep.ts:153`). | S |
| FB-031 | `select` reports success while the form did not change. | bug | `selectOption` and return (`step.ts:334-336`); nothing reads back. | After selecting, poll the native select until it holds the requested options; fail with what it holds instead. Guide: on a custom wrapper, follow with `expect-text` on the visible control. | S–M |
| FB-032 | A popover row passes `expect-visible`, then `click` says "it was not found". | bug (cause unproven) | Same `locate()` for both. "Not found" is a call-log heuristic (`step.ts:437`), so it also covers an element that vanished. Hypothesis: the popover closes between steps. | Reproduce with a blur-to-close popover; if confirmed, say "it was no longer on the page" when the locator resolved earlier. Guide line on popovers. | M |
| FB-033 | `nth: -1` silently picks another element when the intended one leaves the accessibility tree. | gap | `.last()` over role matches (`locator.ts:65`); a focus-hidden element drops out. | `nth` description + guide: order follows the DOM/accessibility tree and can shift; prefer a `css` locator on `name`/`id` in stacked overlays. | S |
| FB-034 | An ambiguous locator's error gives only a count. | gap | `diagnose` (`step.ts:447-450`); Playwright's candidate list rides in the 2 000-char `detail`. | Lift the candidates (role + name) into the error. | S |
| FB-035 | Visually hidden (`sr-only`) radios/checkboxes time out on `click`/`check`. | gap | Playwright's pointer-interception check; no `force` option (D4). | Error hint: "if this is a visually hidden input, click its label or press Space"; guide section. | S |
| FB-036 | A short role name matches a longer button behind an overlay. | works / gap | Substring matching by default is documented. | Guide: `exact: true` plus `nth: -1` for stacked overlays. | S |

Tests: `core/runner/__tests__/executor_browser.test.ts`, `step.test.ts`, shared schema test.

## B5 — Evidence and inspection tell the truth

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-040 | Evidence URLs show `?<REDACTED>` for plain routing parameters. | bug | `withoutQuery` cuts the whole query and hash (`core/runner/browser/step.ts:94-104`), also in `browser/inspect.ts:41` and HTTP evidence (`scheduler.ts:1058-1071`). The key-aware redactor exists (`core/services/secret_utils.ts:606-648,711-748`) and the guide promises its behaviour (`guide.ts:807-808`). | D1: redact per parameter at capture time, masker on top. Update the pinning tests. | M |
| FB-041 | `scope: "auto"` returns the page behind an overlay that is outside `main` and has no dialog role. | gap | `auto` = last dialog, else `main`, else page (`core/services/aria_scope.ts:79-92`); the "left out" note fires only for dialogs (`:113-123`). | Note when content exists outside `main`: "scope `page` shows it". Guide sentence. | S |
| FB-042 | An inspected page can be read once. | gap | Consumed on first terminal read (`core/services/run_service.ts:482-501`); contract not stated in the tool description. | D2: keep it readable until expiry; state the TTL in the description. | S |
| FB-043 | A click that starts a slow request looks like a no-op. | gap | Settle = two equal ARIA snapshots 150 ms apart (`browser/settle.ts:40-68`, `executor.ts:1291-1292`); no "still changing" or pending-request fact. | Report "page still changing when evidence was taken" in `evidenceNote`. Guide: wait on a result element. In-flight request count over CDP is FB-074. | S |
| FB-044 | `browser_inspect` replays the whole chain, repeating side effects. | gap | By design: a page cannot be seeded from a previous run (`core/runner/resume.ts:66-78`). | Guide + known limitations: read the side-effecting step's own stored evidence instead, or stop with `beforeNodeId`. Live-page resume is FB-070. | S |
| FB-045 | `workflows_debugContext` needs `workflowId` even with a `runId`. | gap | Anchored on a workflow (`core/ipc/handlers/workflows.ts:161-168`). | Derive `workflowId` from the run row when only `runId` is given. | S |

Not issues: screenshots for passed steps exist since v1.1.0 (`executor.ts:1255-1266`,
test `executor_browser.test.ts:322-335`) — the note is stale; one-node screenshot
reads and the 24 KiB snapshot cap with `start`/`end` windowing are by design and
already explained in errors.

## B6 — MCP surface and guides

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-050 | `apiweave://guide/…` cannot be read as a file. | gap | `MCP_INSTRUCTIONS` gives the URI only (`core/mcp/guide.ts:891`). | Name `guides_get` next to the URI (fits the 1 600-byte cap, `phase5-edit-path.test.ts:521`). | S |
| FB-051 | `secrets_list` needs `workspaceId`, `scopeType` and `scopeId`. | gap | All required (`core/ipc/handlers/secrets.ts:34`). | `list` only: default to the workspace scope. | S |
| FB-052 | `projects_create` returns `collectionId` with `projectId: null`. | bug | `Collection` still carries a `projectId` column (`shared/zod-schemas/CollectionSchema.ts:10`, `core/repositories/CollectionRepository.ts:30,57,93`), while project-run tools call the collection id `projectId`. | Confirm the column is dead and remove it (schema, repository, migration); one-line note in the `projects_*` descriptions that a project's id is `collectionId`. | S–M |
| FB-053 | `description`/`position` in a node `config` fails with a bare "Unrecognized key". | gap | Strict node configs with zod's default message; the hinting helper `unknownKeyError` (`core/ipc/handlers/common.ts:72`) is not applied to configs. | Hints: `description` → node `label` (except browser steps); `position`, `label`, `parentId` → node, not `config`. Check `workflows_nodeSchema` output is unchanged. | M |
| FB-054 | An unattached workflow is "invisible" in the app. | gap | Sidebar refreshes on MCP writes (`src/hooks/useAgentDataUpdates.ts:37-43`); where unattached workflows appear needs checking. | Verify; guide: create with `collectionId` and tell the user the workspace and project names. | S |
| FB-055 | `runs_create` returns before the run ends. | works | Documented (`core/mcp/tools.ts:222`, `guide.ts:58`). | Optional: one guide line for long browser runs. | S |
| FB-056 | `workflows_get` `view: "nodes"` needs `nodeIds`. | works | Clear error (`core/ipc/handlers/workflows.ts:155-156`). | — | — |
| FB-057 | Inspection contracts the agent had to discover (FB-042, FB-044). | gap | — | Tool descriptions. | S |
| FB-058 | Popovers and focus can change the page between steps (FB-032, FB-033). | gap | — | Guide browser section. | S |
| FB-059 | Called workflows: isolation, typed mappings, `forEach` item shape (FB-013, FB-016). | gap | — | Guide Call Workflow section, written after B2. | S |
| FB-060 | Two browser runs sharing a login break each other. | gap | Scheduler runs 4 at once (`core/runner/scheduler.ts:29`), one browser session per run. | Known limitations + guide: wait for one browser run before starting another that shares its login (D5). | S |
| FB-061 | A save refused by the application under test shows a toast and the step passes. | gap | Correct behaviour for a click. | Guide: assert the page the app goes to after a successful save, not the click. | S |

Guide edits land in `core/mcp/guide.ts` (workflow-authoring `browser` and Call
Workflow sections) and `docs/reference/known-limitations.md`; `MCP_INSTRUCTIONS`
gets FB-050 only.

## B7 — The open canvas stops bumping `rev`

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-006 | `rev` advances between an agent's read and its next patch while the app shows the workflow. | bug (partly proven) | The renderer applies MCP writes and re-baselines autosave, and identical saves are no-ops (`core/repositories/WorkflowRepository.ts:270-323`). But the canvas persists derived state: extractor names are merged into the saved `variables` (`src/contexts/WorkflowContext.tsx:96-121,253-259`, `src/components/WorkflowCanvas.tsx:635-650,1444-1450`) and frame sizes come from React Flow's measurement (`src/adapters/workflowCanvas.ts:123-128`). After a live update this content differs, so autosave writes. | Keep extractor variables out of the persisted `variables`; persist frame size only from an explicit resize; skip a save whose canonical content equals the last applied snapshot. | M |

Tests: `useWorkflowLiveUpdates` + `useAutoSave` integration (apply an external
snapshot to a clean canvas → no save), `WorkflowContext.test.tsx`.

## B8 — Read a run's final variables

| ID | Report | Verdict | Root cause | Fix | Size |
| --- | --- | --- | --- | --- | --- |
| FB-019 | No tool reads a run's final variables (`outputMapping` results, script-set values). | feature | Stored masked by the run's secret masker (`scheduler.ts:603,630`) and sanitised by key (`:1031`), but never exposed. A stale comment claimed they were not masked; triage repeated it. | D3: `runs_get` with `variables: true` returns them, 8 KiB budget, whole entries kept or named as omitted. | M |

## Deferred features

| ID | Request | Why deferred |
| --- | --- | --- |
| FB-070 | `browser_inspect` resumes at a node without replaying side effects. | Needs a live page kept per inspection (the recorder's replay hand-off, `scheduler.ts:334-338`): memory, stale pages, approvals. Revisit after FB-044's guidance. |
| FB-071 | Follow a link that opens a new tab. | One page per run is a settled design (`docs/plans/browser-steps-plan.md`). Workaround: `navigate`. |
| FB-072 | `force` on `click`/`check`. | D4. |
| FB-073 | Serialise browser runs. | D5. |
| FB-074 | Report in-flight requests in step evidence (CDP). | After FB-043 shows whether the cheap signal suffices. |
| FB-075 | Recorder output: dead-end steps, `selector`/css locators, hard-coded data, stale catalog labels. | Separate recorder work; collect concrete cases first. |

## External (closed, no APIWeave change)

Number inputs drop a leading zero; an application's single-session rule; DNS or
VPN outages failing every step at once; public APIs needing `retry`; toasts at
the top of the ARIA snapshot. Recorded so later rounds don't re-triage them.

## Log

- **2026-11-26 — round 1.** Notes linked under `docs/.scratch/field-notes/`.
  Every entry triaged into 47 tracked items (FB-001…FB-075). Misdiagnosed in the notes:
  FB-002 (edge dropped, not dangling), FB-011, FB-012, FB-014 (all FB-010),
  FB-015 (fill already fails on an unresolved placeholder), passed-step
  screenshots (stale).
- **2026-11-26 — B2 merged.** FB-010 and FB-013 fixed; FB-011, FB-012, FB-014
  pinned by tests that pass before and after (the "works" verdicts hold);
  FB-015 fill evidence records the typed value (`<SECRET>` for a secret or
  password); FB-016 guide and two feature docs corrected (calls are child
  runs). Full suite: 3 gRPC TLS failures that also fail on the base commit.
- **2026-11-26 — B4 merged.** FB-030, FB-031, FB-034, FB-035 fixed; FB-033 and
  FB-036 documented. FB-032 not reproduced: a blur-to-close popover stays open
  across evidence capture, so the "not found" wording now says the element may
  have closed or moved since an earlier step saw it. Cause still open; needs a
  concrete page from the field.
- **2026-11-26 — B7 merged.** FB-006 had two causes: extractor names merged
  into the saved `variables`, and display state (branch counts, run status)
  on node `data` read by autosave as an edit. Both fixed; autosave now also
  skips a save equal to the server copy. Frame size was already only written
  on an explicit resize (pinned by a test). Workflows that already stored
  extractor names keep them as ordinary variables (no migration).
- **2026-11-26 — B1 merged.** FB-001…FB-003 fixed: create, update and patch
  reject a sent edge with a missing endpoint, a repeated `edgeId`, or a
  duplicate connection; `duplicate_edge` diagnoses graphs already stored;
  the canvas assertion-branch drag cannot add a duplicate. FB-004/FB-005
  documented. Review found that the canvas saves through `update` with the
  whole edge list, so a stored duplicate or dangling edge would have blocked
  every save: fixed by checking only edges the write adds or changes.
  Repository imports and git sync stay permissive (diagnosed, not refused).
- **2026-11-26 — B3 merged.** FB-017: five copies of the placeholder path
  walker replaced by one shared `readDotPath`; `[n]` resolves in
  `variables`/`env`/`data`, an index past the end stays unresolved. A masked
  variable read through a path (`tokens[0]`) is now refused on rerun (it
  slipped through before). FB-018: one shared reference extractor
  (`shared/analysis/variable_references.ts`) used by the analyzer, node facts
  and the rerun check; `aw.variables.set` counts as a producer; a child's
  inputs supplied by its callers (`inputMapping` keys, `forEach`
  item/index) are no longer flagged. Limits: root names must be identifiers
  (hyphens allowed later in the path); `aw.variables.get` in a script is not
  counted as a read by the analyzer; the canvas still shows the caller-input
  warning because it cannot read other workflows.
- **2026-11-26 — B5 merged.** FB-040: stored run URLs (browser pages,
  inspected pages, request metadata) keep plain parameters; userinfo, the
  fragment, secret-named and credential-looking parameters are withheld.
  Review widened the parameter list beyond config key names (OAuth `code`,
  `sig`/`signature`, bare `key`, `session`/`sid`, SSO tickets and
  assertions). FB-041 auto scope notes content outside `main`; FB-042
  inspected pages re-readable until the 10-minute expiry; FB-043
  `evidenceNote` says when the page was still changing; FB-044 documented;
  FB-045 `debugContext` takes a `runId` alone. B3 + B5 combined needed one
  fix (caller lookup used the optional `workflowId`), caught by typecheck.
  Full suite on the combined branch: only the known flaky tests fail; each
  browser file passes alone except the pre-existing `recording.test.ts`
  iframe case.
- **2026-11-26 — B6 merged.** FB-050 `MCP_INSTRUCTIONS` names `guides_get`
  (1 396 / 1 600 bytes). FB-051 `secrets_list` defaults to the workspace
  scope. FB-052: `Collection.projectId` was dead (never set; every reader fell
  back to `collectionId`) and is removed end to end; it lived in
  `settings_json`, so no migration. FB-053: node-config unknown keys get a
  hint in the MCP validation projection (first version cloned zod internals;
  rejected in review and redone on public issue fields). FB-054: unattached
  workflows are listed under the sidebar's Workflows tab; guide says to file
  with `collectionId`. FB-055, FB-060, FB-061 documented; one dedup pass over
  the guides. start-here size ceiling raised 3 850 → 4 050 chars.
- **2026-11-26 — machine restart.** The per-batch worktrees under `/tmp`
  were lost; all merged work was safe on the tracking branch. B8 had not
  committed and was restarted in the main checkout.
- **2026-11-26 — B8 merged.** FB-019: `runs_get` takes `variables: true`
  (MCP-side projection; the renderer's IPC result is unchanged) and returns
  the stored final variables within an 8 KiB budget, omitted names listed.
  Works for child runs. Storage was already masked by the run's secret
  masker; only the stale comment was wrong, now corrected and pinned by a
  test.
- **2026-11-26 — round 1 verified.** On the tracking branch: typecheck,
  lint and `build:app` pass; `vitest run`: 5 409 passed, 5 failed — the 3
  gRPC TLS tests and 2 `executor_browser` screenshot-evidence tests, which
  also fail intermittently on the base commit `3aca4e67` (2 of 4 runs).
- **Known flaky tests (pre-existing, also fail on `3aca4e67`):** 3 gRPC TLS
  tests (`grpc.test.ts`, `executor_grpc.test.ts`); browser tests under load
  (`recording.test.ts` iframe case, `better_selector`, `pick`, `capture`,
  `executor_browser` screenshot-evidence numbering).
