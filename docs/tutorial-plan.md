# APIWeave In-App Tutorial Plan

*A source-verified curriculum and implementation plan for a searchable, resumable tutorial inside the desktop app. Audited against APIWeave 0.10.2 on 2026-09-19.*

## Prerequisites

- Read [project context](../apiweave-context.md), [design system](../app/DESIGN_SYSTEM.md), and [current visual direction](../DESIGN.md).
- Install dependencies with `npm ci` from `app/`.
- Use DeepSeek V4.1 Flash (`opencode-go/deepseek-v4.1-flash`) for implementation, content data, integration, and tests. Use GPT-6 Astra (`openai/gpt-6-astra`) for UI/UX design and visual review in every phase.

## Contents

- [Goals and product decisions](#goals-and-product-decisions)
- [Verified feature coverage](#verified-feature-coverage)
- [UI and interaction specification](#ui-and-interaction-specification)
- [Content and state architecture](#content-and-state-architecture)
- [Implementation phases](#implementation-phases)
- [Acceptance and verification](#acceptance-and-verification)
- [Delivery record](#delivery-record)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Goals and product decisions

Provide an offline, bundled guide to every shipped user-facing feature. A first-time user should be able to build and inspect a workflow; an experienced user should be able to search for SSE, inheritance, agent sessions, or sync conflicts and reach a concrete explanation directly.

1. Open **Tutorials** from the header or the empty workspace.
2. Choose a short lesson or resume the last lesson.
3. Read the outcome, prerequisites, numbered instructions, example, expected result, and troubleshooting.
4. Choose **Follow along** to use the app while retaining the current instruction.
5. Explicitly mark a lesson complete; revisit or undo completion whenever useful.

No account or network connection is required to read lessons. Network-dependent exercises state their requirements. Lessons about optional integrations remain readable before those integrations are configured. Progress is local to this installation and independent of workflows.

### Audit boundaries

Research covered `docs/getting-started/`, `docs/features/`, `docs/reference/`, the actual renderer routes, node palette and editors, settings, runner and IPC operations, agent integration, and Cloud surfaces. No existing queryable graph was present and codebase-memory tools were unavailable, so evidence comes from source inspection. The existing canvas tips, panel tips, shortcuts modal, and empty state provide small help surfaces, but there is no comprehensive tutorial system.

The curriculum must describe current behavior: full graph runs from Start; projects organize workflows but do not offer one-click ordered execution; Cloud sync transfers structure while execution and secret values remain local. Do not teach disabled resume-from-failure, scheduling, webhooks, remote execution, or revision diffs as available features. Avoid brittle claims about a fixed MCP tool count. Docs are not packaged with the desktop app, so all lesson text must ship in the renderer bundle.

## Verified feature coverage

Every row below must map to a discoverable lesson and include actionable steps, not merely a feature name. Closely related rows may share a lesson; identifiers remain stable for progress and direct links.

| Chapter / suggested lesson | Required coverage | Source evidence |
| --- | --- | --- |
| First steps / `first-workflow` | Create a workflow, automatic Start, add HTTP request and End, connect, configure, Save/700ms auto-save, Run, inspect result; state Internet requirement for public endpoint exercise | `docs/getting-started/first-workflow.md`; `app/src/components/layout/Workspace.tsx`; `app/src/components/WorkflowCanvas.tsx` |
| First steps / `workspaces` | Personal and additional workspaces, switching, scoped resources, moving workflows; local-first operation | `app/src/contexts/WorkspaceContext.tsx`; `app/src/components/organisms/CreateWorkspaceModal.tsx`; `app/src/components/organisms/MoveToWorkspaceDialog.tsx` |
| First steps / `canvas` | Palette, handles, node editing, tabs, copy/paste, undo/redo, grouping/ungrouping, notes, camera lock, canvas prefs, shortcuts and command palette | `app/src/hooks/useNodePaletteSections.ts`; `app/src/components/organisms/CanvasToolbar.tsx`; `app/src/commands/registry.ts`; `app/src/components/organisms/KeyboardShortcutsHelp.tsx` |
| Requests / `http-requests` | Methods, URL/path/query, headers/cookies, bearer/basic/API-key auth, JSON/raw/form/urlencoded/binary/upload bodies, timeout, redirects, TLS, expected status, continue-on-failure; copy as cURL | `app/src/components/node-modal/HTTPRequestConfigPanel.tsx`; `app/src/components/node-modal/`; `docs/features/workflows-and-nodes.md` |
| Requests / `variables-extractors` | Workflow variables, JSON/header/cookie extraction, save response data as variable, chaining and order | `docs/features/variables-and-extractors.md`; `app/src/components/VariablesPanel.tsx`; `app/src/components/molecules/ExtractorForm.tsx`; `app/src/components/molecules/ResponseInspector.tsx` |
| Requests / `placeholders-functions` | `variables`, `env`, `prev`, `secrets`, direct node output references, resolution order, unresolved literals, all currently registered dynamic functions and function browser | `docs/reference/placeholders.md`; `docs/reference/dynamic-functions.md`; `app/shared/constants/dynamicFunctions.ts`; `app/src/components/DynamicFunctionsHelper.tsx` |
| Requests / `environments` | Selection/default, variables, base inheritance and overrides, cycle/depth limit, per-environment Swagger URL | `docs/features/environments-and-secrets.md`; `app/src/pages/WorkspaceEnvironmentsPage.tsx`; `app/src/components/organisms/EnvironmentForm.tsx` |
| Requests / `secrets` | Workspace/environment scopes, environment-first resolution, setting/replacing values, metadata-only display, references, masking and export/sync behavior, resolution confidence | `app/src/pages/WorkspaceSecretsPage.tsx`; `app/src/components/SecretForm.tsx`; `app/core/secrets/`; `docs/features/environments-and-secrets.md` |
| Control / `assertions` | Response/status/header/cookie/variable sources, supported operators, expected status negative tests, pass/fail connections | `app/src/components/node-modal/`; `app/core/mcp/guide.ts`; `docs/features/workflows-and-nodes.md` |
| Control / `delay-merge` | Delay and jitter; merge all/any/first/conditional, branch ordering and End | `app/src/components/nodes/DelayNode.tsx`; `app/src/components/nodes/MergeNode.tsx`; `docs/features/workflows-and-nodes.md` |
| Control / `sse` | Bounded stream, event filters, collect cap, finish trigger, timeout, Ready vs Complete, extraction | `app/src/components/node-modal/SseConfigPanel.tsx`; `app/src/components/nodes/SseNode.tsx`; `docs/features/workflows-and-nodes.md` |
| Control / `call-workflow` | Select child, input/output mappings, shared environment and secrets, no secret mapping, recursion depth | `app/src/components/nodes/CallWorkflowNode.tsx`; `app/src/components/node-modal/`; `docs/features/workflows-and-nodes.md` |
| Debug / `runs-history` | Run/cancel, full graph behavior, node states, timing, request/response inspection, history, failures and unresolved placeholders | `app/src/components/HistoryModal.tsx`; `app/core/runner/`; `app/src/components/organisms/CanvasToolbar.tsx` |
| Debug / `visual-debugging` | Timeline/waterfall, branch durations, variable producer/consumer provenance, secret confidence, camera following/minimap controls | `docs/features/visualization-and-debugging.md`; `app/src/components/organisms/RunTimelinePanel.tsx`; `app/src/components/molecules/VariableProvenanceModal.tsx`; `app/src/hooks/useRunCamera.ts` |
| Organize / `presets` | Save node configuration, workspace library, drag preset, manage presets, local-only behavior | `docs/features/node-presets.md`; `app/src/stores/NodePresetStore.ts`; `app/core/services/node_preset_service.ts` |
| Organize / `projects` | Create/edit project, membership/order, enabled and continue-on-failure metadata, colors, move workflow, current execution limitation | `docs/features/projects.md`; `app/src/pages/WorkspaceProjectPage.tsx`; `app/src/components/CollectionManager.tsx` |
| Organize / `import-export` | Workflow JSON editor/import/export; `.awecollection` import/export; references-only secrets and required local configuration | `app/src/components/WorkflowJsonEditor.tsx`; `app/src/components/WorkflowExportImport.tsx`; `app/src/components/CollectionExportImport.tsx`; `app/core/services/project_export_service.ts` |
| Organize / `openapi` | Spec URL and file import, reusable endpoint templates, environment-linked refresh, supported spec versions, private-host refresh limitations | `docs/features/swagger-import.md`; `app/src/components/OpenAPIImport.tsx`; `app/src/hooks/useSwaggerRefresh.ts` |
| Organize / `curl-har` | Paste/import cURL and HAR, inspect generated requests, account for captured credentials before sharing | `app/src/components/CurlImport.tsx`; `app/src/components/HARImport.tsx`; `app/src/components/ImportToNodesPanel.tsx` |
| Agents / `embedded-agents` | Installed CLI prerequisite, roster/default/custom definitions, folder/workflow launch, context briefing, dock/terminal, activity vs process status, stop/history/resume when supported | `app/src/components/AgentsManager.tsx`; `app/src/components/organisms/AgentDock.tsx`; `app/src/components/organisms/AgentsSettingsPanel.tsx`; `app/shared/agents/builtin-agents.ts` |
| Agents / `mcp` | Enable local bridge, connection config/token, tools/resources/prompts, workflow authoring/debugging, agent updates appearing in app, local scope and metadata-only secrets | `docs/features/mcp-integration.md`; `app/src/components/MCPManager.tsx`; `app/src/components/organisms/McpSetupPanel.tsx`; `app/core/mcp/tools.ts`; `app/core/mcp/guide.ts` |
| App / `settings` | Canvas interaction/tips, appearance where available, private-network opt-in, application vs workspace settings; point to actual controls | `app/src/pages/AppSettingsPage.tsx`; `app/src/components/layout/sidebar/SettingsContent.tsx`; `app/src/stores/CanvasPrefsStore.ts`; `app/src/components/organisms/PrivateNetworksPanel.tsx` |
| App / `cloud` | Optional account, teams/workspaces, linking/sync status, conflicts and recovery/dead letters, encryption/unlock where surfaced, local execution and excluded data | `app/src/pages/cloud/`; `app/src/components/cloud/`; `app/core/sync/`; `docs/reference/architecture.md` |
| App / `updates` | Notify/Automatic/Manual policies, check/download/install controls and status; local desktop startup/recovery | `app/src/components/organisms/UpdateSettingsPanel.tsx`; `app/src/components/organisms/UpdateBanner.tsx`; `app/src/components/BootGate.tsx`; `docs/reference/release-and-updates.md` |

### Documentation corrections discovered

The existing empty-state claim about CI/CD webhooks is incorrect for this desktop app and should be corrected where the tutorial entry is added. Do not copy the retired web marketing page. Existing prose saying "seven node types" is stale: verify palette entries and distinguish executable nodes from Note and Group. Agents and newer Cloud controls are more fully documented in code than in the feature guides.

## UI and interaction specification

### Entry and routes

- A persistent **Tutorials** header action with BookOpen icon and accessible name. Preserve Electron drag behavior with `noDragStyle`.
- A **Start tutorial** / **Continue tutorial** secondary action in `WorkspaceEmptyState`.
- A command-palette entry and links from relevant Variables/Functions tips in the refinement phase.
- Scoped routes `/:workspaceSlug/tutorials` and `/:workspaceSlug/tutorials/:lessonId`, with the existing organization-prefixed route variants as appropriate.
- Use `WorkspacePageRoute` / `CanvasSurfaceContext` to cover the existing mounted canvas. Return to an explicit workspace path, not an assumed browser-history entry. Verify nav-rail Workflows also leaves the tutorial route.

### Library and reader

The wide view has a searchable chapter outline beside a readable article. Base that split on at least 48rem of available tutorial container width, not viewport width: the existing sidebar and agent dock can leave only about 638px at a 1440px viewport. On compact layouts the library and article become separate views with an **All lessons** action. Search titles, summaries, feature keywords and lesson content; retain chapter context in results. Show an informative no-results state with a clear-search action.

```text
Tutorials                                  4 of 24 completed
Learn the workflow, one feature at a time.
[ Search lessons... ]
[ Continue: Chain requests with extracted data ]

First workflow              | Chain requests with extracted data
  Build your first workflow | Outcome + prerequisites
  Canvas and shortcuts      | Numbered actionable steps
Requests and data           | Example + expected result
  HTTP requests             | Troubleshooting + related lessons
  Variables and extractors  | [Follow along] [Mark complete]
```

Use ordinary labelled navigation links/buttons and `aria-current` rather than adding a custom tab widget. Display completed/in-progress status with text plus a glyph. Estimate reading/practice duration without making it a success metric. A single highlighted resume/outcome Card is sufficient; use compact grouped rows for the remaining outline.

### Follow-along companion

One nonmodal complementary panel shows the active lesson and step, step count, short instruction, expected result, Previous/Next, full lesson and Close actions. It stays available while the user operates the app. Do not infer completion from DOM selectors or jump steps automatically. At narrow widths collapse to an accessible resume strip and switch explicitly between the instructions and workspace; never squeeze the canvas into an unusable column.

Mount exactly one companion. Keep the stable canvas/agent component hierarchy and MessagePort ownership intact. Prefer an independent shell overlay with a collapse option over restructuring Allotment panes. Persist lesson/step so reload and reopening can resume, but do not automatically reopen a companion at boot.

Phase 2 design refinement: mount the companion as a stable sibling in MainLayout's main-content region. At approximately 52rem available width, show a 20rem lower-left panel, leaving the usual right inspector unobstructed. Below that threshold, start with a resume strip and expand instructions over the content area on request; covered content must be inert while those instructions are expanded. Keep a visible **Back to workspace** action. Preserve focus within instructions on reflow; if workspace focus is active when width shrinks, collapse rather than unexpectedly cover it. Escape is handled only from inside the companion.

Keep practice lesson/step separate from the last-read lesson so consulting a related article never changes the active exercise. Previous/Next only changes the practice step; completion is explicit at the last step. Label the existing lesson-wide expectation **Lesson result** rather than suggesting it is a step validation. Internal destinations use router navigation, never document anchors; Cloud uses its actual global `/cloud/sync` route and pauses presentation because it is outside MainLayout.

### Visual and accessibility detail

- Use existing semantic warm-paper/zinc and ink-teal tokens, existing proportional font classes, `font-mono` for examples, hairline borders, restrained corners and spacing.
- Body copy `text-sm` with comfortable line height and a maximum article measure around 70 characters; meaningful instructions use primary/secondary text rather than muted text.
- Use Button, IconButton, Panel, Card, SearchInput, EmptyState and established tooltips/toasts where applicable. Do not duplicate primitive styles.
- Route/lesson changes focus the article heading; completion has a polite announcement; copy examples report success/failure accessibly.
- Long expressions wrap or scroll inside their own code container. Avoid horizontal page overflow. Keep final steps/actions reachable in short windows.
- Support keyboard-only navigation, visible focus, dark/light themes, reduced motion, and 375/768/1024/1440px widths. No forced first-run modal or pulsing spotlight.

## Content and state architecture

Use bundled typed content under `app/src/constants/tutorials/`; split by chapter rather than a single giant JSX file. Each lesson has a stable ID, chapter, title, outcome/summary, keywords, duration, prerequisites, ordered steps, example, expected result, troubleshooting and related IDs. Every step has a stable title and explicit instruction. Optional feature destinations should be a small verified route set, not arbitrary commands or a generic automation engine.

Use renderer-only local persistence for completed lesson IDs, last lesson and current step. Use established guarded localStorage/Zustand patterns, sanitize stored values and filter unknown lesson IDs. Storage failure must leave the tutorial usable in memory. Keep open/collapsed companion state ephemeral. Provide reversible completion and a deliberate reset-progress action with confirmation. Never write tutorial progress into WorkflowContext or sync payloads.

Suggested modules: `TutorialPage`, `TutorialLibrary`, `TutorialLesson`, `TutorialCompanion`, `TutorialStore`, and small reusable lesson/example molecules where needed. Put every type/interface in its own `src/types/` file and export through the barrel. Use the router and existing dependencies; no tutorial framework or new backend is needed.

## Implementation phases

### Phase 1 — Complete learning library

**DeepSeek Flash:** implement typed curriculum covering the matrix, progress store, routes, library/reader, search, header and welcome entry, reversible completion/resume/reset, meaningful state/navigation tests. Verify concrete syntax against source. Correct stale welcome copy at the touched entry point.

**GPT-6 Astra:** review the phase's design against current components; provide precise UI adjustments, then inspect the implemented hierarchy, focus, typography and compact view. Design instructions are handed to DeepSeek for coding.

**Exit:** all audited feature groups are readable in the installed bundle; search finds advanced topics; users can leave, reload and resume without changing workflows; full checks pass. Suggested commit: `feat(tutorial): add comprehensive learning library`.

### Phase 2 — Follow-along companion

**GPT-6 Astra:** specify the active-step panel, wide/compact presentations, collapse/close/focus behavior and how actions avoid obstructing the canvas.

**DeepSeek Flash:** implement single-instance shell companion, persisted current step, previous/next, open full lesson, resume/collapse/close, and explicit navigation to applicable existing surfaces. The first-workflow lesson must give a complete practical exercise through the existing New Workflow path. Reading/navigation must never create or mutate resources automatically. Add targeted tests of route switching, bounds, state restoration and canvas stability.

**Exit:** a user can build a first workflow with instructions at hand, visit settings for another lesson, return and resume the correct step. Narrow screens retain access to both workspace and instructions. Suggested commit: `feat(tutorial): add follow-along lessons`.

### Phase 3 — Contextual discovery and verification

**GPT-6 Astra:** review actual rendered light/dark and compact/wide screenshots, keyboard/focus behavior and lesson readability; specify any final refinements.

**DeepSeek Flash:** add tutorial command and relevant contextual help links; add focused Playwright flows using the existing desktop IPC fixture; fix verified content/behavior issues; document tutorial usage and maintainability. Test coverage should protect behavior, not duplicate lesson data.

**Exit:** keyboard users can discover and complete lessons; contextual links reach the correct topic; screenshots show no tutorial overflow; all quality gates pass and the packaged app contains the lessons. Suggested commit: `feat(tutorial): connect contextual help and validate learning flows`.

## Acceptance and verification

Run from `app/` after each implementation phase:

```powershell
npm test
npm run typecheck
npm run lint
npm run build:app
npm run build
```

Serialize native test/build steps: tests prepare SQLite for Node; packaging prepares it for Electron. Do not run their native rebuilds concurrently. Record failures honestly and fix phase regressions before advancing. Run `graphify update .` after code modifications as required by repository instructions, recording any tool limitation. Do not stage scratch/work tracking files.

Meaningful checks include malformed/disabled storage, unknown lesson links, case-insensitive search and no results, completion and undo/reset, reload-resume, bounded companion steps, direct scoped routes, leaving via Workflows, canvas remaining mounted, nonmutation of domain data, and responsive/keyboard navigation. Add focused Playwright tutorial scenarios on the desktop IPC fixture and capture representative light/dark and narrow/wide evidence. Test only actual shipped feature destinations.

## Delivery record

- Audit and design: complete. DeepSeek Flash inspected docs/code; GPT-6 Astra reviewed current design and shell integration.
- Baseline: `npm ci`, typecheck, lint, `build:app` and Windows NSIS/MSI installer builds passed. Unit suite: 220 files, 2,557 passed and 4 skipped. Desktop Playwright smoke: 4 passed.
- Phase 1 accepted: 24 bundled lessons across seven chapters, routed library/reader, search, progress and header/welcome entries. Hardening corrected the first exercise, explicit placeholder namespaces, HashRouter destinations, progress storage failures, focus, contrast and short-window scrolling. Final gates passed: 2,629 tests passed, 4 skipped; typecheck, lint, app build and NSIS/MSI packaging passed. Advanced lesson content has a separate accuracy review in progress.
- Phase 2 implemented pending phase gates: single follow-along companion mounted once in the main content region, 20rem floating panel at 52rem available width, compact resume strip with an inert-covered expansion, practice position separated from reading position, explicit completion at the final step, and router-based destinations. An advanced lesson accuracy review corrected SSE, merge, call-workflow, preset, project, import/export, MCP, Cloud and update details; structured examples are validated against shipped schemas.
- Graph maintenance: `graphify update .` rebuilt the initially absent graph (7,679 nodes). Tool warnings identify zero-node JSON fixtures and unavailable SQL parsing; they do not block tutorial execution.

## Troubleshooting

- If a lesson differs from the app, verify its visible labels against the referenced editor/route and correct the bundled content.
- If navigation hides the canvas permanently, check `WorkspacePageRoute` coverage cleanup and explicit return routing.
- If progress cannot persist, retain in-memory operation and check renderer storage availability.
- If installer or test execution reports a native SQLite ABI mismatch, run the corresponding rebuild script for Node or Electron and serialize those operations.

## Related

- [Documentation hub](README.md)
- [First workflow](getting-started/first-workflow.md)
- [Architecture](reference/architecture.md)
- [Visual design system](../DESIGN.md)
