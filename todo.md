# TODO — Run from Last Failed Node

Status legend:
- [ ] Not done
- [x] Done

## Current Progress Snapshot (2026-02-22)
- [x] Run split-button/dropdown implemented in canvas toolbar.
- [x] Backend resume API contract implemented (`single` and `all-failed`).
- [x] Latest-failed metadata endpoint implemented and wired to UI.
- [x] Resume context hydration implemented (results + variables).
- [x] Repeated failed-resume chain fix implemented (lineage-based hydration).
- [x] Failed run persistence improved to keep variables/failedNodes for follow-up resumes.
- [x] Focused backend resume regression suite passing (`10 passed`).
- [x] Frontend production build passing.

### Remaining Work
- [ ] Manual end-to-end verification in UI with real workflow data.
- [ ] Optional docs update for repeated failed-resume behavior and lineage hydration.

## Phase 1 — Product behavior & API contract
- [ ] Define UX behavior for Run split/dropdown:
  - [ ] Keep primary click as normal full run.
  - [ ] Add dropdown option: "Run from last failed node".
  - [ ] Add submenu/list of failed nodes from latest failed run.
  - [ ] Add action: "Run all failed nodes and continue".
  - [ ] Define disabled state when no failed run exists.
- [ ] Define backend contract changes for run trigger:
  - [ ] Extend `POST /api/workflows/{workflow_id}/run` to accept optional resume payload:
    - [ ] `resumeSourceRunId` (latest failed run id)
    - [ ] `startNodeIds` (one or more failed nodes)
    - [ ] `resumeMode` (`single` | `all-failed`)
  - [ ] Validate all `startNodeIds` belong to the workflow graph.
  - [ ] Return resume metadata in response for observability.
- [ ] Define retrieval contract for last failed node:
  - [ ] Always use latest failed run for current workflow.
  - [ ] Return all failed node IDs plus labels/types for dropdown display.
  - [ ] Preserve deterministic ordering for failed nodes.
- [ ] Lock confirmed product decisions:
  - [ ] Use latest failed run as source.
  - [ ] Support one or multiple failed nodes.
  - [ ] Reuse previous run context (variables + responses) when resuming.
  - [ ] Continue downstream execution from resumed failed nodes.
- [ ] Commit phase 1 (do not include todo/learning files):
  - [ ] `git add backend/app/routes/workflows.py backend/app/models.py frontend/src/components/organisms/CanvasToolbar.jsx frontend/src/hooks/useWorkflowPolling.js`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "feat(run): define API and UX contract for run from last failed node"`

## Phase 2 — Backend execution resume-entry support
- [ ] Implement optional resume-entry path in executor:
  - [ ] Add `start_node_ids` support in `WorkflowExecutor` constructor.
  - [ ] In `execute()`, start from `startNodeIds` when present; fallback to `start` node otherwise.
  - [ ] Support multi-entry resume (more than one failed node) in one run.
  - [ ] Keep existing behavior when parameter is absent.
- [ ] Implement route-level handling:
  - [ ] Parse resume payload from request body.
  - [ ] Validate node(s) exist in workflow graph.
  - [ ] Persist metadata on run document (recommended: `resumeFromRunId`, `resumeFromNodeIds`, `resumeMode`).
- [ ] Add safety checks:
  - [ ] Reject invalid node type targets if required (e.g., `start`/`end` policy).
  - [ ] Return clear 4xx errors for invalid resume requests.
- [ ] Commit phase 2 (do not include todo/learning files):
  - [ ] `git add backend/app/runner/executor.py backend/app/routes/workflows.py backend/app/models.py`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "feat(run): support optional start node execution"`

## Phase 3 — Backend "latest failed run" resolution
- [x] Add helper/query path to resolve resumable node set from latest failed run:
  - [x] Read latest failed run for workflow.
  - [x] Use run details (`failedNodes`, `nodeStatuses`) to determine node set.
  - [x] Return actionable error if no failed node exists.
- [x] Expose endpoint or inline route behavior:
  - [x] Option A: New endpoint to fetch last failed run resume metadata.
  - [ ] Option B: Resolve during run trigger when mode = `lastFailed`.
- [x] Commit phase 3 (do not include todo/learning files):
  - [x] `git add backend/app/routes/workflows.py backend/app/repositories/run_repository.py`
  - [x] `git restore --staged todo.md progress/learnings.md`
  - [x] `git commit -m "feat(run): resolve last failed node from latest failed run"`

## Phase 4 — Resume context hydration (critical)
- [ ] Hydrate resume context from source failed run:
  - [ ] Rebuild `prev` response/result context for resumed node(s) from stored `node_results`.
  - [ ] Restore extracted workflow variables from source run context.
  - [ ] Ensure environment and secrets substitution remain compatible.
- [ ] Define fallback behavior for missing historical data:
  - [ ] If required prior result is missing, return clear error and suggest full run.
  - [ ] Do not silently run with partial context when it would corrupt flow logic.
- [ ] Commit phase 4 (do not include todo/learning files):
  - [ ] `git add backend/app/runner/executor.py backend/app/routes/workflows.py backend/app/repositories/run_repository.py`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "feat(run): hydrate resume context from latest failed run"`

## Phase 5 — Frontend toolbar split-button/dropdown
- [ ] Update canvas toolbar run control:
  - [ ] Convert `Run` button to split/dropdown action.
  - [ ] Primary action remains `Run` (full workflow).
  - [ ] Dropdown actions:
    - [ ] `Run from last failed node` (single selection)
    - [ ] `Run all failed nodes and continue`
- [ ] Keep design-system alignment:
  - [ ] Reuse existing Tailwind tokens and component patterns.
  - [ ] Keep compact toolbar density and current keyboard behavior.
- [ ] Add loading/disabled states:
  - [ ] Disable dropdown while running.
  - [ ] Disable/tooltip resume actions when no latest failed run exists.
- [ ] Commit phase 5 (do not include todo/learning files):
  - [ ] `git add frontend/src/components/organisms/CanvasToolbar.jsx frontend/src/components/WorkflowCanvas.jsx`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "feat(ui): add run split-button with last failed option"`

## Phase 6 — Frontend run orchestration changes
- [ ] Extend `useWorkflowPolling` run APIs:
  - [ ] `runWorkflow()` for normal run.
  - [ ] `runFromNode(nodeId, sourceRunId)` for explicit resume.
  - [ ] `runFromAllFailed(sourceRunId)` for multi-resume.
  - [ ] `runFromLastFailed()` to fetch/resolve and trigger resume mode.
- [ ] Ensure secrets prompt compatibility:
  - [ ] Preserve runtime-secrets flow for resume mode.
  - [ ] Keep adaptive polling and status update behavior unchanged.
- [ ] Improve user feedback:
  - [ ] Toast on resume start with node label/id.
  - [ ] Toast on multi-resume start with failed node count.
  - [ ] Clear error message when no failed run/node is available.
- [ ] Commit phase 6 (do not include todo/learning files):
  - [ ] `git add frontend/src/hooks/useWorkflowPolling.js frontend/src/components/WorkflowCanvas.jsx`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "feat(run): wire resume from last failed node in polling hook"`

## Phase 7 — Validation and docs
- [ ] Backend validation:
  - [ ] Run `Lint Backend (Pylint)` task.
  - [ ] Run focused backend tests around workflow run routes/executor behavior.
- [ ] Frontend validation:
  - [ ] Run frontend build to verify no JSX/runtime regressions.
  - [ ] Manual check: full run, failed run, resume single failed node, resume all failed nodes.
  - [ ] Manual check: resume after parallel branch failures (NB3/NB4-style scenario).
- [ ] Update docs:
  - [ ] `docs/WORKFLOWS_AND_NODES.md` with split-run behavior.
  - [ ] `docs/FAQ_TROUBLESHOOTING.md` with resume edge cases and context requirements.
- [ ] Commit phase 7 (do not include todo/learning files):
  - [ ] `git add docs/WORKFLOWS_AND_NODES.md docs/FAQ_TROUBLESHOOTING.md`
  - [ ] `git restore --staged todo.md progress/learnings.md`
  - [ ] `git commit -m "docs(run): document run from last failed node behavior"`

## Confirmed requirements from discussion
- [x] Use latest **failed** run as resume source.
- [x] Support more than one failed node in complex workflows.
- [x] Reuse previous run data (variables and responses) for resume execution.
- [x] If one or both parallel nodes fail, resume them and continue the workflow downstream.
