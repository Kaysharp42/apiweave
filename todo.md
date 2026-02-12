# Workflow Editor Data-Loss Fix Plan

Issue: a workflow that should contain 14 nodes currently resolves to only the default start node payload (`nodes=[start-1], edges=[], variables={...}`) in the JSON editor, which suggests a load/save or JSON-view hydration regression and possible overwrite path.

## Phase 1 - Reproduce and Capture Evidence
- [x] Done - Reproduce with the exact affected workflow and record the timeline (open workflow, wait, edit, save/autosave, refresh).
- [x] Done - Capture API payloads for `GET /api/workflows/{id}`, list endpoints (`/api/workflows`, `/api/workflows/unattached`), and every `PUT /api/workflows/{id}` fired by the editor.
- [x] Done - Confirm whether the database already contains only the start node or whether the collapse happens in the frontend before save.
- [x] Done - Write a failing regression test that reproduces the current bad behavior (at minimum one backend/API-level regression test).
- [x] Done - Run phase tests and checks (`pytest` and frontend build/lint as applicable).
- [x] Done - Commit Phase 1 with message format: `test(regression): reproduce workflow graph collapse issue`.

## Phase 2 - Trace and Isolate Root Cause in Load Path
- [x] Done - Trace workflow open flow end-to-end: Sidebar/Workspace tab open -> TabStore payload -> WorkflowProvider -> WorkflowCanvas initialization.
- [x] Done - Validate whether tab opening uses summary data instead of a full workflow fetch by ID and whether missing `nodes/edges` falls back to `initialNodes`.
- [x] Done - Add guardrails in investigation notes for the exact break point (file + function + condition).
- [x] Done - Write/extend tests for load-path correctness (opening an existing workflow must hydrate full graph, not default start graph).
- [x] Done - Run phase tests and checks.
- [x] Done - Commit Phase 2 with message format: `test(workspace): lock expected workflow hydration behavior`.

## Phase 3 - Implement Fix for Workflow Hydration
- [x] Done - Update workflow-open behavior to always hydrate from `GET /api/workflows/{id}` (or equivalent guaranteed-full payload) before editor state is considered ready.
- [x] Done - Add defensive handling in `WorkflowCanvas` so incomplete payloads never silently become authoritative graph state.
- [x] Done - Ensure tab re-activation refreshes stale/incomplete tab workflow objects safely.
- [x] Done - Write tests for the new hydration behavior (including incomplete payload fallback scenarios).
- [x] Done - Run phase tests and checks.
- [x] Done - Commit Phase 3 with message format: `fix(workspace): hydrate workflow editor from canonical workflow payload`.

## Phase 4 - Implement Save-Path Safety Nets
- [x] Done - Prevent destructive save when graph appears unintentionally collapsed (for example: only default start node while canonical workflow has more nodes).
- [x] Done - Ensure autosave cannot run before initial workflow hydration is complete.
- [x] Done - Add structured logging/telemetry around save payload size (node/edge counts) to detect future regressions quickly.
- [x] Done - Write tests covering autosave/manual-save safeguards and non-destructive behavior.
- [x] Done - Fix JSON editor editing session stability by seeding content once per open cycle and freezing the payload snapshot while modal is open.
- [x] Done - Stop save-loop PUT spam by removing save-path tab payload feedback and skipping autosave during active run polling updates.
- [x] Done - Run phase tests and checks.
- [x] Done - Commit Phase 4 with message format: `fix(editor): block destructive autosave on incomplete graph state`.

## Phase 5 - Recovery and Verification of Affected Data
- [x] Done - Verify whether the affected 14-node workflow can be restored from history/export/backups (or reconstruct from run artifacts if available).
- [x] Done - Validate restored workflow integrity (node count, edge count, variable mappings, execution path).
- [x] Done - Add a one-time verification script/checklist for other workflows that may have been overwritten similarly.
- [x] Done - Write tests for any recovery script/validator logic introduced.
- [x] Done - Run phase tests and checks.
- [x] Done - Commit Phase 5 with message format: `chore(recovery): validate and restore impacted workflows`.

## Phase 6 - Final QA and Rollout
- [x] Done - Run full smoke QA: open existing large workflows, edit nodes, autosave, reload, switch tabs, and verify graph persistence.
- [x] Done - Verify no regression in JSON editor import/apply and workflow create flow.
- [x] Done - Document root cause, fix details, and operator runbook in `progress/learnings.md`.
- [x] Done - Write final integration/regression test additions (if any remaining gap exists).
- [x] Done - Run final test suite/build checks.
- [x] Done - Commit Phase 6 with message format: `docs+qa: finalize workflow editor persistence regression fix`.

---

## Phase Exit Rule (applies to every phase)
- [x] Done - Every phase must include at least one test addition/update.
- [x] Done - Every phase must end with: tests passing -> commit created -> short note of what changed and why.
