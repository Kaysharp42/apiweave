# Phase 1 - Source Audit and Documentation Architecture

Date: 2026-02-12
Source todo: `todo.md` (Phase 1)

## Scope and method

- Audited all files in `progress/` by filename and document heading, then mapped each file to one primary category: product, architecture, API, operations, or historical context.
- Audited current docs in `docs/` and root `README.md` for stale links, duplicate topics, and missing coverage.
- Audited backend/frontend code to build a canonical feature inventory from routes, models, runner behavior, UI modules, stores, and hooks.
- Defined a documentation information architecture with ownership and update cadence for upcoming phases.

## 1) `progress/` index and category map

Total indexed files: 83

### Product (20)

- `progress/ASSERTION_NODE_FEATURE.md`
- `progress/COLLECTION_ASSIGNMENT_FEATURE.md`
- `progress/COLLECTION_ASSIGNMENT_VISUAL_GUIDE.md`
- `progress/COLLECTION_USER_GUIDE.md`
- `progress/CONTINUE_ON_FAIL_FEATURE.md`
- `progress/CONTINUE_ON_FAIL_INTEGRATION.md`
- `progress/COPY_PASTE_FEATURE.md`
- `progress/DOCUMENTATION_INDEX.md`
- `progress/DYNAMIC_FUNCTIONS_FEATURE.md`
- `progress/DYNAMIC_FUNCTIONS_FRONTEND_INTEGRATION.md`
- `progress/DYNAMIC_FUNCTIONS_README.md`
- `progress/ENVIRONMENTS_AND_SECRETS.md`
- `progress/ENVIRONMENT_VARIABLES_DEBUG.md`
- `progress/ENVIRONMENT_VARIABLES_VISUAL_GUIDE.md`
- `progress/FILE_UPLOAD_CODE_REFERENCE.md`
- `progress/FILE_UPLOAD_VISUAL_GUIDE.md`
- `progress/NODE_RESIZE_QUICK_REFERENCE.md`
- `progress/README_ENVIRONMENTS_SECRETS.md`
- `progress/UI_PERFORMANCE_OPTIMIZATIONS.md`
- `progress/apiweave-context.md`

### Architecture (9)

- `progress/ARCHITECTURE_DIAGRAMS.md`
- `progress/ARCHITECTURE_WORKFLOW_VARIABLES.md`
- `progress/CI_CD_INTEGRATION_DESIGN.md`
- `progress/COLLECTION_EXPORT_IMPORT_DESIGN.md`
- `progress/COLLECTION_UI_DESIGN.md`
- `progress/CONTEXT_API_SOLUTION.md`
- `progress/LAYOUT_DIAGRAM.md`
- `progress/OAUTH_ARCHITECTURE_DECISION.md`
- `progress/panelDesign.md`

### API (13)

- `progress/BEANIE_MIGRATION_COMPLETE.md`
- `progress/BEANIE_MIGRATION_GUIDE.md`
- `progress/BEANIE_MIGRATION_STATUS.md`
- `progress/CI_CD_API_APPROACH.md`
- `progress/CI_CD_WEBHOOK_IMPLEMENTATION_PLAN.md`
- `progress/COLLECTION_EXPORT_IMPORT.md`
- `progress/DYNAMIC_FUNCTIONS_API_REFERENCE.md`
- `progress/EMOJI_REMOVAL_MIGRATION.md`
- `progress/GRIDFS_LARGE_RESULTS.md`
- `progress/IMPORT_FUNCTIONALITY_CLEANUP.md`
- `progress/WEBHOOK_FILE_UPLOAD_INTEGRATION.md`
- `progress/WEBHOOK_IMPLEMENTATION_SUMMARY.md`
- `progress/WORKFLOW_EXPORT_IMPORT_README.md`

### Operations (13)

- `progress/CI_CD_QUICK_START.md`
- `progress/ENVIRONMENTS_SECRETS_STATUS.md`
- `progress/FILE_UPLOAD_IMPLEMENTATION_STATUS.md`
- `progress/HOW_TO_TEST_ENVIRONMENT_VARIABLES.md`
- `progress/PHASE_1_COMPLETION_REPORT.md`
- `progress/PROJECT_STATE_2026-02-08.md`
- `progress/QUICK_CONTEXT.md`
- `progress/SESSION_SUMMARY.md`
- `progress/TESTING_GUIDE.md`
- `progress/TESTING_GUIDE_COLLISION_AVOIDANCE.md`
- `progress/TROUBLESHOOTING_COLLECTIONS.md`
- `progress/TROUBLESHOOTING_ENVIRONMENT_VARIABLES.md`
- `progress/workflow-editor-incident-2026-02-12.md`

### Historical Context (28)

- `progress/BUG_ANALYSIS_MERGE_DOUBLE_EXECUTION.md`
- `progress/BUG_TRACKER.md`
- `progress/CHANGELOG_WORKFLOW_VARIABLES.md`
- `progress/CI_CD_INTEGRATION_SUMMARY.md`
- `progress/CODE_CHANGES_SUMMARY.md`
- `progress/COLLECTION_FEATURE_SUMMARY.md`
- `progress/DAY3_AUTHENTICATION_SECURITY_SUMMARY.md`
- `progress/DYNAMIC_FUNCTIONS_COMPLETION_CHECKLIST.md`
- `progress/DYNAMIC_FUNCTIONS_IMPLEMENTATION_SUMMARY.md`
- `progress/ENVIRONMENT_VARIABLES_COMPLETE_FIX.md`
- `progress/ENVIRONMENT_VARIABLES_FIX.md`
- `progress/ENVIRONMENT_VARIABLES_FIX_SUMMARY.md`
- `progress/FILE_UPLOAD_FEATURE_PLAN.md`
- `progress/FIX_COLLECTIONS_LOADING.md`
- `progress/IMPLEMENTATION_CHECKLIST.md`
- `progress/IMPLEMENTATION_COMPLETE_SUMMARY.md`
- `progress/IMPLEMENTATION_SUMMARY.md`
- `progress/NODE_RESIZE_TRACKING_COMPLETE.md`
- `progress/PERSISTENT_NODE_TEMPLATES_IMPLEMENTATION.md`
- `progress/PHASE2_CODE_CHANGES.md`
- `progress/PHASE2_COMPLETE.md`
- `progress/PHASE2_IMPLEMENTATION_GUIDE.md`
- `progress/PHASE2_QUICK_REFERENCE.md`
- `progress/VISUAL_PROGRESS_MAP.md`
- `progress/WORKFLOW_VARIABLES_COMPLETE.md`
- `progress/learnings.md`
- `progress/old-todo-.md`
- `progress/todo.md`

## 2) Current docs audit (`docs/` + root `README.md`)

### Existing docs footprint

- `docs/` currently contains five docs: `VARIABLES.md`, `WORKFLOW_VARIABLES.md`, `WORKFLOW_VARIABLES_QUICKSTART.md`, `WEBHOOK_QUICKSTART.md`, `SWAGGER_UI_BASE_URL_IMPORT.md`.
- Root `README.md` exists but references several doc targets that do not currently exist.

### Stale and broken links found

Broken markdown links in `README.md`:

- docs/API.md
- docs/INSTALLATION.md
- docs/WORKFLOW_SCHEMA.md
- docs/GITLAB_CI.md
- CONTRIBUTING.md

Non-link plain-text references in `docs/WEBHOOK_QUICKSTART.md` also point to missing docs:

- docs/WEBHOOK_TESTING_GUIDE.md
- docs/WEBHOOK_IMPLEMENTATION_SUMMARY.md
- docs/CI_CD_WEBHOOK_IMPLEMENTATION_PLAN.md

### Duplicate and overlapping content

- Workflow variable docs are split across three files with overlapping examples and terminology:
  - `docs/VARIABLES.md`
  - `docs/WORKFLOW_VARIABLES.md`
  - `docs/WORKFLOW_VARIABLES_QUICKSTART.md`
- There is no canonical index in `docs/` to define source of truth vs quick reference.

### Missing topic coverage (relative to current codebase)

- No centralized docs hub (docs/README, planned) and no navigation index (docs/NAVIGATION, planned).
- No architecture reference for current ReactFlow workspace, Zustand stores, runner lifecycle, or Beanie data model.
- No complete API reference for route groups under:
  - `/api/workflows`
  - `/api/runs`
  - `/api/environments`
  - `/api/collections`
  - `/api/webhooks`
- No operations runbook coverage for deploy, backup/restore, incident triage, or security posture.

## 3) Canonical feature inventory from code audit

### Backend inventory

- App entrypoint and router wiring in `backend/app/main.py`.
- Route modules in `backend/app/routes/`:
  - `workflows.py` (27 route handlers)
  - `collections.py` (12 route handlers)
  - `environments.py` (8 route handlers)
  - `runs.py` (5 route handlers)
  - `webhooks.py` (10 route handlers)
- Data model definitions in `backend/app/models.py` (29 classes), including Beanie documents:
  - `Workflow`, `Run`, `Environment`, `Collection`, `Webhook`, `CollectionRun`, `WebhookLog`
- Repository layer in `backend/app/repositories/`:
  - `workflow_repository.py`
  - `run_repository.py`
  - `environment_repository.py`
  - `collection_repository.py`
  - `webhook_repository.py`
  - `collection_run_repository.py`
- Runner and execution pipeline in:
  - `backend/app/runner/executor.py`
  - `backend/app/runner/dynamic_functions.py`
  - `backend/app/worker.py`
- Import/discovery helper utilities in:
  - `backend/app/utils/swagger_discovery.py`
  - `backend/app/utils/openapi_examples.py`
  - `backend/app/utils/openapi_import_limits.py`
  - `backend/app/utils/workflow_integrity.py`

### Frontend inventory

- App shell and global providers in `frontend/src/App.jsx`.
- Core pages:
  - `frontend/src/pages/Home.jsx`
  - `frontend/src/pages/WorkflowEditor.jsx`
- Layout shell in `frontend/src/components/layout/`:
  - `MainLayout.jsx`, `MainHeader.jsx`, `MainFooter.jsx`, `Sidebar.jsx`, `SidebarHeader.jsx`, `Workspace.jsx`, `AppNavBar.jsx`
- Canvas runtime in `frontend/src/components/WorkflowCanvas.jsx` with ReactFlow, toolbar actions, JSON editor flow, Swagger refresh, polling, and autosave orchestration.
- Node system in `frontend/src/components/nodes/`:
  - `StartNode.jsx`, `EndNode.jsx`, `HTTPRequestNode.jsx`, `AssertionNode.jsx`, `DelayNode.jsx`, `MergeNode.jsx`
- Atomic design layers:
  - Atoms: 13 files in `frontend/src/components/atoms/`
  - Molecules: 10 files in `frontend/src/components/molecules/`
  - Organisms: 4 files in `frontend/src/components/organisms/`
- State and context:
  - Zustand stores in `frontend/src/stores/`: `CanvasStore.js`, `NavigationStore.js`, `SidebarStore.js`, `TabStore.js`
  - React contexts in `frontend/src/contexts/`: `WorkflowContext.jsx`, `PaletteContext.jsx`
- Hooks in `frontend/src/hooks/`:
  - `useAutoSave.js`, `useCanvasDrop.js`, `useKeyboardShortcuts.js`, `useWorkflowPolling.js`
- Utility modules in `frontend/src/utils/`:
  - `api.js`, `icons.js`, `workflowSaveSafety.js`, `swaggerRefreshSummary.js`

## 4) Documentation information architecture (target)

This is the Phase 1 information architecture baseline for implementation in later phases.

### Proposed top-level doc map

- `README.md` - product entry point, quick start, and top-level links.
- `docs/README (planned)` - central docs hub by audience.
- `docs/NAVIGATION (planned)` - deterministic start-here paths and quick links.
- `docs/product/` - end-user workflows, node behavior, environments, collections, import/export, troubleshooting.
- `docs/developer/` - frontend/backend architecture, extension patterns, sequence diagrams, code conventions.
- `docs/api/` - endpoint reference, request/response contracts, error semantics, examples.
- `docs/operations/` - deployment, security controls, runbooks, incident and recovery procedures.
- `progress/` - historical notes, working plans, implementation journals, and session artifacts.

### Ownership model

- Product docs owner: frontend maintainer(s).
- Developer docs owner: full-stack maintainer(s).
- API reference owner: backend maintainer(s).
- Operations docs owner: deploy/operator maintainer(s).
- Historical docs owner: active implementation contributor for each phase.

### Update cadence

- Per PR touching behavior: update affected canonical docs in `docs/` before merge.
- Weekly docs hygiene pass: run docs checks, review stale links, and align terminology.
- End of each phase: add a short phase note and learnings entry; keep `progress/` historical, not canonical.
- Monthly ops review: runbook accuracy, security limitation notes, and deployment instructions.

## 5) Phase note

- This phase establishes a source-of-truth map before any broad rewrites, so later documentation work can move quickly without duplicating or contradicting legacy notes.
