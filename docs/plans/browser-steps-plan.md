# Browser steps plan

## Status

| Phase | Branch | State |
| --- | --- | --- |
| 0: Spike — packaging, CLI, recorder payloads, toolbar | `Kaysharp42/playwright-automation` | **Done** (findings below) |
| 1: `browser` node, runner, evidence | `Kaysharp42/playwright-automation` | **Done** (notes below) |
| 2: Agents author and repair browser steps over MCP | `feat/browser-agents` | Not started |
| 3: Recorder — record steps into nodes | `feat/browser-recorder` | Not started |
| 4: Checks, extracts and dialogs while recording | `feat/browser-recorder-checks` | Not started |
| 5: Update one node — re-pick an element, re-record from a step | `feat/browser-node-repick` | Not started |

**Base.** `main` with PR #196 merged (`5670ac42`). The next migration number is `033`.

## Goal

A user who is neither a tester nor a frontend developer gets a workflow with **one node per step** that checks a web page, and runs it whenever they like, mixed freely with the HTTP nodes they already have. There are two ways to get the steps: **record** them by clicking through the page, or ask a **coding agent** (OpenCode, Claude Code, Codex…) connected to APIWeave to build them.

The motivating flow: after merging, the user runs the workflow **from the desktop app on their own PC** against the dev environment. The test account's email comes from an environment variable (`{{env.TEST_EMAIL}}`) and its password from a secret (`{{secrets.TEST_PASSWORD}}`). The same workflow must also run from `apiweave run` (the CLI), even though CI is not the focus yet.

## Settled decisions

1. **One node per step.** A new node type `browser`, with one `action` per node.
2. **One browser per run.** The first `browser` node in a run starts it, every later `browser` node reuses its page, and it closes when the run ends. Call Workflow children share it, the same way they share the run's `CookieJar` (`core/runner/executor.ts`, `cookieJar`).
3. **Browser nodes are totally ordered.** Any two `browser` nodes in a workflow must be connected by a path. HTTP and other nodes can branch around them freely.
4. **Reruns restart the browser chain.** A rerun whose scope includes a `browser` node starts at the first `browser` node, because a page cannot be seeded from the source run.
5. **Secrets never reach a workflow, a stored result or a sync.** A recorded password becomes `{{secrets.NAME}}`, and the raw value is discarded.
6. **Evidence on failure.** A failed step keeps a screenshot (password fields masked) and the page's ARIA (accessibility) snapshot, with secrets masked.
7. **The installed browser.** Runs use the machine's installed Chrome or Edge through Playwright's `channel`, with a fresh profile. Nothing is downloaded, and the user's everyday profile is never touched.
8. **Desktop and CLI share one runner.** `playwright-core` is a runtime dependency that both bundles leave external, so the same code runs in Electron's main process and under plain Node.

## Out of scope for these phases

- CI documentation and a CI browser story (the CLI runs browser workflows from Phase 1, but nothing is tuned or documented for pipelines yet).
- Firefox and WebKit. Chromium-family only (Chrome, Edge, or Playwright's own Chromium if installed).
- Multiple tabs and popups. A step that opens a popup fails with "not supported yet", and the recorder warns.
- File uploads, downloads, drag and drop, visual (pixel) diffs.
- Reusing a saved login state (`storageState`). Login is ordinary steps, ideally once, in a sub-workflow called through Call Workflow.
- Triggers or reminders after a merge.

---

## Phase 0 findings

The spike scripts are in `docs/.scratch/browser-spike/` (never committed). Everything ran on Windows 11 with `playwright-core` 1.64.1 (already installed through `@playwright/test`), against an in-process HTTP fixture page.

### Packaging and CLI: the external-dependency approach works in both places

- **CLI.** An entry bundled the way `core/cli` is bundled (esbuild, `cjs`, `node20`, `--external:playwright-core`) produced a 3 KB bundle. Under plain Node it launched headless Edge in about 0.16 s (Chrome about 0.33 s), filled a form with public locators (`getByLabel`, `getByRole`), read text, took an ARIA snapshot and a JPEG screenshot.
- **Electron and asar.** An Electron 44 main process loaded from an `app.asar` containing `node_modules/playwright-core` resolved it from inside the archive, launched headless Edge, clicked, took an ARIA snapshot and a screenshot. **No `build.asarUnpack` entry is needed.** The full `electron-builder` package with the fuses is checked at the end of Phase 1, once product code uses it.
- **Decision.** Add `"playwright-core": "1.64.1"` (exact, matching `@playwright/test` so there is one copy) to `dependencies`. Both esbuild configs then leave it external automatically (`external: Object.keys(dependencies)`), electron-builder ships it, and `scripts/build-cli-package.mjs` adds it to the CLI package's dependencies.

### Recorder payloads (`BrowserContext._startRecording`)

`_startRecording({ language: "javascript" }, { actionAdded, actionUpdated, signalAdded })` starts Playwright's `ProgrammaticRecorderApp`. Playwright's own CLI/MCP tool records through the same call. It works **headless** too, which makes the converter testable without a visible window.

| Interaction | Event(s) | `action` payload (trimmed) |
| --- | --- | --- |
| page opens | `actionAdded` | `{ name: "openPage", url: "about:blank" }` |
| `goto` | `actionAdded` | `{ name: "navigate", url }` |
| click into a field, then type | `actionAdded` click, then `actionAdded` fill, then one `actionUpdated` fill **per keystroke** | `{ name: "fill", selector: 'internal:role=textbox[name="Email"i]', text: "me@example.com" }` |
| checkbox | `actionAdded` | `{ name: "check", selector: 'internal:role=checkbox[name="Remember me"i]' }` |
| select | `actionAdded` | `{ name: "select", selector: 'internal:label="Plan"i', options: ["Pro"] }` |
| button | `actionAdded` | `{ name: "click", selector: 'internal:role=button[name="Sign in"i]', button, modifiers, clickCount }` |
| button in a repeated row | `actionAdded` | `selector: 'internal:role=listitem >> internal:has-text="Row B Delete"i >> internal:role=button'` |
| `confirm()` dialog | `signalAdded` on the action that caused it | `{ name: "dialog", dialogAlias: "" }`. The generated code **dismisses** it |
| element inside an iframe | `actionAdded` | `selector: 'iframe[title="embedded"] >> internal:control=enter-frame >> internal:role=button[name="Inside frame"i]'` |
| key | `actionAdded` | `{ name: "press", key: "Enter", modifiers: 0 }`, sometimes followed by a spurious `click` with `clickCount: 0` |

Every action also carries `ref` and **`ariaSnapshot`: the whole page's snapshot at that moment, including typed field values, the password in plain text** (`textbox "Password": hunter22`).

Consequences, all applied below:

- The converter **never keeps the recorder's `ariaSnapshot`**, and fills are turned into templates before anything leaves main.
- The converter drops a `click` that is immediately followed by a `fill` on the same selector (focusing the field is not a step), and drops `click` with `clickCount: 0`.
- `fill` arrives as one add plus many updates. The renderer updates the last node instead of adding one, and main sends updates at most every 150 ms.
- The locator model needs `hasText` (from `internal:has-text`) and `frame` (from `… >> internal:control=enter-frame >> …`).

### In-page toolbar and checks

The programmatic recorder shows Playwright's **in-page toolbar** (verified with a raw DevTools screenshot, because Playwright hides its overlays in its own screenshots). Its buttons are Record, Pick locator, Assert visibility, Assert text, Assert value and Assert snapshot. The assert modes emit actions through the same sink:

- `{ name: "assertVisible", selector }` on click
- `{ name: "assertValue", selector, value: "abc" }` on click
- Assert text opens an in-page box, "Assert that element contains text", prefilled with the element's text, editable, and confirmed with ✓. Confirming emits `assertText`.

**Decision.** Phase 4 gets its checks UI for free. It maps those actions instead of building a toolbar.

### Evidence leaks typed values

`locator.ariaSnapshot()` at run time also contains input values, the password included (`textbox "Password": s3cret-value`). `page.screenshot({ mask: [page.locator("input[type=password]")] })` correctly paints the password box over. **Decision.** The ARIA snapshot goes through the run's secret masker, *and* the runner adds every value it filled into an `input[type=password]` to that run's masked values, so a password that did not come from `{{secrets.*}}` is masked too.

### Environment note (unrelated to the feature)

`npm ci` with npm 12.0.2 tried to compile `better-sqlite3` with `node-gyp` and failed on a machine without Visual Studio, even though the package ships Windows prebuilds and loads fine. `npm ci --ignore-scripts` followed by `node node_modules/electron/install.js` worked. Worth a separate issue against `scripts/setup.ps1`.

---

## Architecture

```
renderer                         main (privileged)                 core (Electron-free, shared with the CLI)
─────────                        ─────────────────                 ─────────────────────────────────────────
BrowserNode / ConfigPanel                                          shared/zod-schemas/BrowserNodeDataSchema.ts
Record button ──► __APIWEAVE_RECORDER__ ──► RecorderService ──┐    core/runner/browser/session.ts   (launch, page, close)
   ▲                                       (_startRecording)  │    core/runner/browser/locator.ts   (structured locator → Playwright)
   └── recorded step events ◄──────────────────────────────────┘    core/runner/browser/actions.ts   (one function per action)
WorkflowContext inserts nodes                                      core/runner/browser/recorded.ts  (recorder action → BrowserNodeData)
                                                                   core/runner/browser/selector_parse.ts
Run ──► runs.create (router) ─────────────────────────────────────► WorkflowExecutor → browser session
Agent ─► MCP: workflows_patch, runs_create, browser_inspect ──────► same executor, always headless
```

- **Runner code** lives in `core/runner/browser/` and imports `playwright-core` only. No Electron, so `apiweave run` keeps building.
- **Recording** opens a visible browser on the user's desktop and sees what they type. It is privileged: a direct `ipcMain.handle` behind `requireTrustedSender`, in its own preload world `__APIWEAVE_RECORDER__`, never on the router. No MCP path reaches it.
- **Running and inspecting** go through the router, so agents can use them. Anything started over MCP is **always headless**, whatever the desktop setting says, so an agent never pops a window on the user's screen.
- **Recorded nodes** are persisted through `WorkflowContext` and auto-save, like any other canvas edit. The recorder never writes workflows itself.

---

## Data model

### `browser` node config (`BrowserNodeDataSchema`)

A discriminated union on `action`. Every variant shares:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `action` | see below | — | discriminant |
| `timeoutMs` | int | 10000 (`navigate`: 30000) | Playwright auto-waits up to this |
| `description` | string, optional | — | Free text. The canvas label falls back to a generated summary such as `Click "Save"` |

| `action` | Extra fields | Playwright call |
| --- | --- | --- |
| `navigate` | `url` (templated) | `page.goto(url, { waitUntil: "load" })` |
| `click` | `locator`, `button?`, `clickCount?`, `modifiers?`, `dialog?` | `locator.click()` |
| `fill` | `locator`, `value` (templated) | `locator.fill(value)` |
| `press` | `locator?`, `key` (e.g. `Enter`, `Control+A`) | `locator.press` or `page.keyboard.press` |
| `check` / `uncheck` | `locator` | `locator.check()` / `uncheck()` |
| `select` | `locator`, `values: string[]` (templated) | `locator.selectOption(values)` |
| `hover` | `locator` | `locator.hover()` |
| `expect-visible` | `locator`, `visible: boolean` (default true) | `locator.waitFor({ state })` |
| `expect-text` | `locator`, `text` (templated), `match: "equals" \| "contains" \| "matches"` | polled `locator.innerText()` |
| `expect-value` | `locator`, `value` (templated) | polled `locator.inputValue()` |
| `expect-url` | `url` (templated), `match` | polled `page.url()` |
| `extract` | `locator?`, `from: "text" \| "value" \| "attribute" \| "url" \| "title"`, `attribute?`, `variable` | writes `{{variables.<variable>}}` |

- `playwright-core` has no `expect` (that lives in `@playwright/test`), so `expect-*` poll with a shared `pollUntil(timeoutMs, check)` at 100 ms intervals and fail with the expected and actual values.
- `dialog?: "accept" | "dismiss"` (on `click` and `press`) registers a one-shot `page.once("dialog")` handler before the step. Without it, Playwright dismisses dialogs, which cancels `confirm()` flows.

### Locator (`BrowserLocatorSchema`)

Structured, so the config panel edits it field by field, zod validates it, and agents patch it without learning Playwright's selector grammar. Every kind maps to a **public** Playwright method:

```ts
type BrowserLocator = (
  | { kind: "role"; role: AriaRole; name?: string; exact?: boolean }
  | { kind: "label" | "placeholder" | "text" | "alt" | "title"; value: string; exact?: boolean }
  | { kind: "testId"; value: string }
  | { kind: "css"; value: string }
  | { kind: "selector"; value: string } // raw Playwright selector: recorder fallback only
) & {
  hasText?: string           // .filter({ hasText })
  nth?: number               // .nth(n)
  within?: BrowserLocator    // parent: within.<this>
  frame?: string             // CSS of the iframe: page.locator(frame).contentFrame().<this>
}
```

- `role` → `getByRole(role, { name, exact })`, `label` → `getByLabel`, `testId` → `getByTestId`, and so on. The chain is built outside-in: `frame`, then `within`, then the kind, then `hasText`, then `nth`.
- `selector` exists so a recording never loses a step it cannot parse. It runs through `page.locator(value)`, shows read-only in the panel with **Re-pick element** (Phase 5), and raises an analyzer notice.
- Locator values are templated (`{{env.*}}`, `{{variables.*}}`).
- The canvas and panel display a locator as Playwright code, e.g. `getByRole('button', { name: 'Save' })`.

### Example

```json
[
  { "nodeId": "b1", "type": "browser", "config": { "action": "navigate", "url": "{{env.BASE_URL}}/login" } },
  { "nodeId": "b2", "type": "browser", "config": { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Email" }, "value": "{{env.TEST_EMAIL}}" } },
  { "nodeId": "b3", "type": "browser", "config": { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Password" }, "value": "{{secrets.TEST_PASSWORD}}" } },
  { "nodeId": "b4", "type": "browser", "config": { "action": "click", "locator": { "kind": "role", "role": "button", "name": "Sign in" } } },
  { "nodeId": "b5", "type": "browser", "config": { "action": "expect-text", "locator": { "kind": "role", "role": "heading", "name": "Dashboard" }, "text": "Dashboard", "match": "contains" } }
]
```

### Node result

A `browser` node result carries the existing status and error fields plus a `browser` member:

- `action`, `durationMs`, plus `url` and `title` after the step
- `expected` and `actual` for `expect-*` actions, and the extracted value for `extract`
- on failure: `ariaSnapshot` (capped at 64 KB) and `screenshotArtifactId`

**Masking.** Fill values are recorded as their template (`{{secrets.TEST_PASSWORD}}`), never as the resolved text. The ARIA snapshot and every other string go through the run's secret masker at the scheduler's persistence boundary, and the masker also receives every value filled into an `input[type=password]` in that run (see Phase 0 findings).

### Screenshots: `033_run_artifacts.sql`

```sql
CREATE TABLE run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 'screenshot'
  mime TEXT NOT NULL,           -- 'image/jpeg'
  body BLOB NOT NULL,
  size INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX run_artifacts_run ON run_artifacts(run_id, node_id);
```

- Follows the `run_responses` BLOB precedent and is accessed only through a new `RunArtifactRepository`. Deleting a run deletes its screenshots.
- One JPEG per failed node, quality 70, viewport only, at most 1 MB (dropped with a note if larger). The spike's screenshot was about 13 KB.
- Taken with `mask: [page.locator("input[type=password]")]`. **Known limitation:** pixels cannot be secret-masked. If a page *displays* a secret as text, the screenshot shows it. Documented in `known-limitations.md`.
- Artifacts are never exported.

---

## Runner semantics

### Session lifecycle (`core/runner/browser/session.ts`)

- Created lazily by the first `browser` node of a run: `chromium.launch({ channel, headless })`, then one `newContext()` and one `newPage()`.
- Owned by the top-level `WorkflowExecutor` and passed to Call Workflow children through `ExecutorDeps`, like `cookieJar`. Only the owner closes it.
- Closed in `executeWorkflow`'s `finally`, next to `abortSseListeners()`, so a failure, a cancellation or an executor exception never leaves a browser running. Cancelling the run also aborts the in-flight Playwright call.
- Launch options come from `ExecutorDeps.browser: { channel, headless }`. Desktop runs read the per-machine setting, MCP-started runs force `headless: true`, and the CLI takes `--browser chrome|msedge|chromium` (default: the first found of chrome, msedge, chromium) and `--headed`.
- A missing browser fails the node with an actionable message ("Microsoft Edge was not found. Choose another browser in Settings → Browser, or pass --browser").
- Each scheduled run, and each data-driven iteration, gets its own browser: isolated state for about 0.2 s of launch.

### Execution

- `executeNode` dispatches `nodeType === "browser"` to `core/runner/browser/actions.ts`, keeping `executor.ts` thin.
- Templates in `url`, `value`, `text`, `values` and locator values resolve through the executor's existing resolver: `{{env.*}}`, `{{secrets.*}}`, `{{variables.*}}`, `{{prev.*}}`.
- `extract` writes a workflow variable, so later HTTP nodes can use something read from the page.
- A new run option, `stopBeforeNodeId`, next to the existing `startNodeIds`: the run executes every node up to that one and stops. It is used by `browser_inspect` (Phase 2) and re-pick (Phase 5).

### Interaction with existing features

| Feature | Rule |
| --- | --- |
| Parallel branches | Rejected by the analyzer (`browser_parallel_branches`, an error) |
| Rerun from a failed node (`seedResume`) | If the rerun scope includes a `browser` node, the entry becomes the first `browser` node. Nodes before it keep their seeded results |
| Call Workflow | The child shares the parent's session |
| Call Workflow `forEach` with `concurrency > 1` | The node fails before starting if the target workflow contains `browser` nodes. `concurrency: 1` shares the session |
| Load runs | Refused up front if the workflow, or any workflow it calls, contains `browser` nodes |
| Data-driven runs | One browser per iteration |
| Snapshot and contract checks | Not applicable to `browser` nodes |

### Analyzer (`shared/analysis/workflow_graph_analyzer.ts`)

- `browser_parallel_branches` (error): two `browser` nodes where neither can reach the other. Remediation names both.
- `browser_chain_starts_without_navigate` (warning): the earliest `browser` node is not `navigate`, and no Call Workflow before it could have navigated.
- `browser_selector_fallback` (notice): a step uses `kind: "selector"`.
- Variable provenance: an `extract` step provides `variables.<variable>`.

---

## Settings

Settings → **Browser**, per machine and never in workflows (stored like the network settings):

- **Browser:** Chrome, Edge, or Playwright Chromium. The default is the first one installed.
- **Show the browser during runs:** off by default. Applies only to runs started from the desktop UI.

---

## Who does the work: models and subagents

The coordinating session runs on **Opus 5.5** (`anthropic/claude-opus-5-5`). It plans each phase, splits it into tasks, and gives every task to the model below.

| Model | Takes | Examples |
| --- | --- | --- |
| **Opus 5.5** (`anthropic/claude-opus-5-5`) | **Hard** work: anything where a subtle mistake breaks runs, leaks a secret or corrupts state. **UI** work: anything the user sees and touches | Executor integration (session ownership, `finally` close, rerun entry rule, `stopBeforeNodeId`, `forEach`/load refusals); `core/runner/browser/session.ts` and `actions.ts`; secret masking and password-field values; analyzer graph rules; `selector_parse.ts` and `recorded.ts`; the recorder service, its preload world and the template substitution; `browser_inspect`; every renderer component (`BrowserNode`, `BrowserConfigPanel`, locator editor, recording toolbar and dialog, re-pick flow) |
| **DeepSeek Flash subagent** (`opencode-go/deepseek-v4.1-flash`) | **Everything else**: well-specified work that follows an existing pattern | Zod schemas and their one-per-file types; node-type registration; `033_run_artifacts.sql` and `RunArtifactRepository`; the `runs:getArtifact` handler; Settings → Browser wiring; `scripts/build-cli-package.mjs` and `package.json`; the renderer registry checklist (palette sections, presets, commands, modal metadata); `node_facts.ts`/`workflow_reads.ts` additions; table-driven unit tests; MCP whitelist entry; docs and `CHANGELOG.md` |

When a task is unclear, it counts as hard. A Flash task that fails its checks twice goes to Opus 5.5 instead of a third attempt.

**One subagent at a time.** Tasks run strictly one after another, never in parallel, so no two agents edit the worktree at once. For each task:

1. Opus 5.5 writes a self-contained prompt: the goal, the exact files, the pattern to copy (with a path), the rules in `AGENTS.md` that apply, and the checks to run.
2. One subagent does the task and reports.
3. Opus 5.5 reads the whole diff, fixes or sends it back, and runs the checks (`npm test`, `npm run typecheck`, `npm run lint`, plus `npm run build:cli` when runner code changed) before the next task starts.
4. Opus 5.5 commits the task (conventional commit), so every task can be reviewed and reverted on its own.

---

## Phase 1 — `browser` node, runner and evidence

Steps written by hand in the panel or JSON editor. Since node schemas reach agents through `workflows.nodeSchema`, an agent can already write them at the end of this phase, but without seeing the page (that is Phase 2).

**Shared**
- `shared/zod-schemas/BrowserNodeDataSchema.ts`, `BrowserLocatorSchema.ts`, `BrowserActionSchema.ts`, and their types in `shared/types/` (one per file, `z.infer`).
- Register `browser` in `WorkflowNodeTypeSchema.ts`, `WorkflowNodeSchema.ts`, `NodePresetNodeTypeSchema.ts` and `NodePresetSchema.ts`.
- Analyzer rules and provenance (above).

**Runner**
- `core/runner/browser/{session,locator,actions,poll}.ts`.
- `executor.ts`: dispatch, session ownership, close in `finally`, the rerun entry rule, the `forEach` and load-run refusals, and `stopBeforeNodeId`.
- `ExecutorDeps.browser`. The scheduler fills it from the setting on desktop and forces headless for MCP-origin runs. CLI: `--browser`, `--headed`.
- Password-field values added to the run's masker.

**Dependency**
- `"playwright-core": "1.64.1"` in `dependencies`. Add it to `scripts/build-cli-package.mjs`.

**Persistence and IPC**
- `033_run_artifacts.sql` and `RunArtifactRepository` (registered in `core/repositories/index.ts`).
- Router handler `runs:getArtifact(artifactId)` → `{ mime, base64 }`, read-only. Keyed by the
  artifact rather than by a run: a rerun copies a failed step's result unchanged, so the
  screenshot still belongs to the run that took it.
- Settings → Browser, wired through the same path as the network settings.

**Services**
- `node_facts.ts`, `workflow_reads.ts` and `assertion_authoring_service.ts` learn the `browser` type, the same files PR #196 touched for WebSocket (`ced54ca7`).

**Renderer** (the same registry list as the WebSocket node in PR #196)
- `src/components/nodes/BrowserNode.tsx`: action icon, generated summary, locator as code, live status.
- `src/components/node-modal/BrowserConfigPanel.tsx`: action picker, the action's fields, a locator editor (kind select plus fields; `selector` read-only). The result tab shows the screenshot, ARIA snapshot, expected and actual values, and URL.
- `NodeModal.tsx`, `NodeModalHeader.tsx`, `WorkflowCanvas.tsx`, `WorkflowJsonEditor.tsx`, `useCanvasDrop.ts`, `useNodePaletteSections.ts` (a **Browser** section with one preset per common action), `nodePresets.ts`, `commands/registry.ts`, `nodeModalUtils.ts`, `nodeModalMeta.ts`, and the renderer types.

**Tests**
- Unit: schemas, locator → Playwright call mapping (a fake `Page`), analyzer rules, rerun entry rule, `forEach` and load refusals, `pollUntil`, `stopBeforeNodeId`.
- Integration, `core/runner/__tests__/executor_browser.test.ts`: an in-process HTTP server serves fixture HTML, and a real headless browser runs a workflow mixing `http-request` and `browser` nodes, including a failed `expect-text` that stores a screenshot. **Skipped unless a Chromium-family browser is found** (`APIWEAVE_TEST_BROWSER=chrome|msedge|chromium`, or auto-detected), so `npm test` stays green without one.
- Masking: a fill with `{{secrets.X}}` stores the template, and neither the secret nor a literal password-field value appears anywhere in the stored run, including the ARIA snapshot.
- CLI: `apiweave run` on an exported fixture workflow with `--browser msedge` exits 0, and 1 after the fixture text changes.

**Docs:** `docs/features/browser-steps.md` (new), `workflows-and-nodes.md`, `known-limitations.md`, the MCP guide (`core/mcp/guide.ts`), `CHANGELOG.md` under Unreleased.

**As built (differences from the text above):**
- Browser errors are fixed `Browser step: …` messages built from the action and the locator as written; `safeErrorClass` keeps that prefix. Expected/found values, Playwright's `detail`, the page URL (query and fragment redacted) and the ARIA snapshot live in the result's `browser` member, which the run's masker scrubs like a response body.
- `{{secrets.*}}` is accepted only in a fill's value. An unresolved placeholder fails the step instead of being typed.
- In an agent run limited to approved hosts, `navigate` and typing a secret are refused on any other host (`SafeHttp.assertHostAllowed`).
- A step that opens a popup closes it and fails.
- The rerun rule also treats a Call Workflow node whose target has browser steps as part of the chain. Load runs ask the scheduler (`hasBrowserSteps`) so called workflows count.
- `runs_getNodeResult` does not return the `browser` member yet: that is Phase 2. The network settings (proxy, CAs, client certificates) do not apply to browser steps yet.
- esbuild's Node bundles turn lazy `import()` into `require` (`supported: { "dynamic-import": false }`); the packaged smoke test loads `playwright-core` (`loadBrowserDriver`).
- A `navigate` shows as `PAGE /path` in the workspace map.

**Done when:** the example workflow, plus one HTTP node, runs green against a fixture page from the desktop app (headless and with **Show the browser** on) and from the CLI; it fails with a screenshot and a masked ARIA snapshot when the heading text changes; and a packaged Windows build (`npm run build`, `scripts/smoke-packaged.mjs`) runs it.

## Phase 2 — Agents author and repair browser steps over MCP

A connected coding agent can already *write* `browser` nodes after Phase 1, but it cannot *see* the page, so it would guess locators from the frontend source. This phase lets it look, the same way it reads API responses today.

- **`browser_inspect` MCP tool** (router handler, whitelisted in `core/mcp/tools.ts`, *not* `readOnlyHint`, because it sends real traffic like `runs_create`): `{ workflowId, environmentId?, beforeNodeId? | url? }`. It runs the workflow headless up to `beforeNodeId` (`stopBeforeNodeId`), or opens `url` on a fresh page, and returns the page's URL, title and **masked ARIA snapshot**, capped. The agent picks role and label locators from that snapshot, the same thing Playwright's recorder does.
- **Failure evidence over MCP.** `runs_getNodeResult` and `workflows_debugContext` include the `browser` member (masked ARIA snapshot, expected and actual, URL). The screenshot is available as MCP image content behind an opt-in parameter, size-capped.
- **Guide.** A `browser` section in `core/mcp/guide.ts`: the locator kinds and their order of preference (role, label, test id, then the rest; `selector` never), the "inspect, then add the next steps, then run" loop, and the repair recipe (read the failing node's snapshot, patch that one node with `workflows_patch`, rerun; the rerun rule restarts the browser chain automatically).
- **`/apiweave:e2e`.** The prompt learns that a task naming a page or a user flow ("check the checkout page after login") is a browser task. The agent reads the frontend code for intent, inspects the page, builds `browser` nodes (with `{{env.*}}` and `{{secrets.*}}` for credentials, never literals), runs them, and keeps the existing rule: separate a broken test from a broken app, and never weaken a check to turn a run green.

**Tests:** handler tests for `browser_inspect` (fixture server, skipped without a browser), MCP whitelist test updated, guide snapshot test, masking test on the inspect output.

**Done when:** from OpenCode, `/apiweave:e2e "log in and check the dashboard heading"` against the fixture app produces a passing workflow with credentials as templates; and after the fixture's button is renamed, the agent repairs the one failing node using only MCP tools.

## Phase 3 — Recorder

**Flow**
1. The user clicks **Record** in the canvas toolbar. If a node is selected, recorded steps go after it; otherwise after Start.
2. A small dialog asks for the start URL, prefilled with `{{env.BASE_URL}}` resolved, when the environment defines it.
3. Main launches a **headed** browser (the configured channel, fresh profile) and calls `_startRecording`. Playwright's in-page toolbar appears in the page. The canvas toolbar shows "Recording — N steps — Stop".
4. Each recorded action becomes a `browser` node, inserted live through `WorkflowContext`, chained with edges, and wrapped in a new frame (`type: "group"`) named `Recording <date>`. `actionUpdated` updates the last inserted node instead of adding one.
5. **Stop**, or closing the browser, ends the recording. The steps are already saved through auto-save.

**Main process (privileged)**
- `electron/recorder_service.ts` plus `__APIWEAVE_RECORDER__` in `preload.ts`: `start({ workflowId, startUrl })`, `stop()`, `status()`, and step events to the renderer on a privileged channel, throttled to one update per 150 ms per node. Behind `requireTrustedSender`, off the router, one recording at a time.
- Conversion is Electron-free and unit-tested in core:
  - `core/runner/browser/selector_parse.ts` parses Playwright's selector strings into `BrowserLocator`: `internal:role=…[name="…"i]`, `internal:label`, `internal:attr=[placeholder=…]`, `internal:text`, `internal:testid`, `internal:has-text` (→ `hasText`), `nth=`, `>>` chains (→ `within`), and `<css> >> internal:control=enter-frame >> …` (→ `frame`). Anything else becomes `{ kind: "selector" }`. A trailing `i` means case-insensitive (`exact: false`); `s` means exact.
  - `core/runner/browser/recorded.ts` turns a recorder `action` into `BrowserNodeData`. Rules from Phase 0: `openPage` produces no node, and the first `navigate` keeps its URL (templated, see below); a `click` immediately followed by a `fill` on the same selector is dropped; a `click` with `clickCount: 0` is dropped; `select.options` → `values`; the `press` modifier bitmask → a key string such as `Control+Enter`; `closePage` produces no node; a popup produces a warning and no node. **The action's `ariaSnapshot` and `ref` are discarded.**

**Values become templates before they leave main.** The raw text never reaches the renderer or the workflow:
- A fill whose text **equals the value of a variable in the selected environment** becomes `{{env.KEY}}`. Typing the test email from `TEST_EMAIL` yields `{{env.TEST_EMAIL}}`. The same applies to the navigate URL's prefix (`BASE_URL`).
- A fill whose text **equals a secret resolvable in the current scope chain** becomes `{{secrets.KEY}}`.
- A fill into a **password field** that matches no secret becomes `{{secrets.UNSET_PASSWORD_1}}`, and the node is flagged *needs secret*. The panel offers **Save as secret** (the existing libsodium write flow) or a choice of existing secret names. The raw value is dropped either way. Until it is resolved, the node shows a *needs secret* badge, and a run fails that step with "secret UNSET_PASSWORD_1 is not set" rather than typing the placeholder.
- Because `fill` arrives keystroke by keystroke, matching runs on the latest text each time. A half-typed password is never sent to the renderer: password fields send only the template.

**Tests:** parser table tests built from the Phase 0 payloads (`docs/.scratch/browser-spike/events-msedge.json` moved into a committed fixture with the password replaced); converter tests; substitution tests (env match, secret match, unmatched password, half-typed values); a recorder service test that drives a fixture page headless through `_startRecording`, skipped without a browser.

**Done when:** recording the login-and-dashboard flow on a fixture page produces the example workflow, with the email and password as templates and no click-before-fill noise, and it passes when run.

## Phase 4 — Checks, extracts and dialogs while recording

- **Checks** come from Playwright's toolbar (Phase 0): `assertVisible` → `expect-visible`, `assertText` → `expect-text` (`match: "contains"`, the text the user confirmed), `assertValue` → `expect-value`. `assertSnapshot` is not supported yet; it is dropped with a warning in the recording status bar. Checked values go through the same template substitution as fills.
- **Extract.** Playwright's toolbar has no extract mode. The canvas offers **Turn into extract** on any recorded node that has a locator: it keeps the locator, switches the action, and asks for a variable name.
- **Dialogs.** The recorder's `dialog` signal sets `dialog` on the step that caused it. During recording Playwright dismisses dialogs, so the recorded value is `dismiss`. The node panel lets the user switch it to `accept`, and the recording status bar shows a hint when a dialog was seen.

**Done when:** a recorded flow includes a text check, a visibility check and an extract without hand-editing JSON, and a `confirm()` flow passes after switching its step to `accept`.

## Phase 5 — Update one node

The user's "update a single node later" goal.

- **Re-pick element** on a `browser` node runs the workflow headed with `stopBeforeNodeId` set to that node, then starts recording. The first recorded action's locator replaces the node's locator, and the action and value stay.
- **Re-record from here** does the same replay, then recording continues, and the new steps **replace** the nodes after the selected one in its chain (undo restores them).
- Both are privileged recorder operations (same preload world).

**Done when:** after a button is renamed on the fixture page, the failing step is fixed with one re-pick, and no other node changes.

---

## Rules that apply to every phase

Everything in `AGENTS.md` and the "Rules that apply to every task" of `docs/plans/protocols-and-testing-plan.md`, plus:

- `core/runner/browser/` imports `playwright-core` and nothing from Electron.
- No raw SQL outside `core/db/` and `core/repositories/`.
- The recorder, and anything that opens a *visible* browser, stays off the router.
- A resolved secret, or a value typed into a password field, is never written to a workflow, a run result, a log line, an MCP response or an IPC message to the renderer.
- Every Playwright version bump re-runs the recorder parser tests against freshly captured payloads (`docs/.scratch/browser-spike/record.cjs`).
- Before handing back: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:app`, `npm run build:cli`.

## Risks

| Risk | Mitigation |
| --- | --- |
| `_startRecording` changes in a future Playwright | Exact version pin, parser and converter tests on captured payloads, and the `selector` fallback, so a format change degrades to fragile steps instead of lost ones |
| Recorder and ARIA snapshots carry typed values, passwords included | Recorder snapshots discarded; run snapshots masked with secrets *and* password-field values; covered by tests |
| Corporate policy blocks browser automation on managed machines | Clear launch error; switching between Chrome and Edge often works around it |
| Screenshot shows a secret the page displays as text | Password fields masked, screenshots only on failure, documented limitation |
| Agents guess locators badly | `browser_inspect` gives them the page's accessibility tree, and the guide ranks locator kinds |
| Flaky steps on a slow dev environment | Playwright auto-waiting, per-node `timeoutMs`, polling for `expect-*` instead of fixed delays |
| Canvas clutter from long recordings | One frame per recording (frames are ignored by the runner), and auto-layout of the inserted chain |
