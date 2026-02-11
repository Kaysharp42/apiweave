# Swagger Environment Sync - Implementation Plan

> Created: 2026-02-11
> Goal: Fix false "Check API" warnings, add warning details popover, and add a manual "Refresh now" action.

---

## Phase 1 - Fix false warnings and empty node side effects

Status: **Done**

- [x] Done - Add endpoint fingerprint metadata for OpenAPI templates (method + normalized path + operationId when available).
- [x] Done - Pass metadata from Add Nodes templates into dropped canvas nodes.
- [x] Done - Change warning logic to only warn schema-linked nodes, not all HTTP nodes.
- [x] Done - Warn only when a meaningful mismatch is detected (missing endpoint, method mismatch, or schema-linked endpoint changed).
- [x] Done - Do not overwrite existing node config/body/headers during refresh.
- [x] Done - Keep non-schema/manual HTTP nodes unchanged and without warning.

### Phase 1 test and commit (required before Phase 2)

- [x] Done - Run backend validation for modified Python files.
- [x] Done - Run frontend build and verify no runtime errors.
- [x] Done - Manual QA: load workspace with Swagger URL, confirm only relevant nodes get warnings.
- [x] Done - Commit Phase 1 only.

Suggested commands:

```bash
python -m compileall backend/app
cd frontend && npm run build
git add -A
git commit -m "fix: scope swagger warnings to schema-linked nodes"
```

Execution log (Phase 1):

- [x] Done - `0f21d68` backend OpenAPI fingerprint metadata.
- [x] Done - `b2bfbf8` preserve OpenAPI metadata through palette/drop pipeline.
- [x] Done - `12496c9` schema warnings limited to Swagger-linked nodes with mismatch tiers.
- [x] Done - `0048874` docs updates for checklist and learnings.

---

## Phase 2 - Add warning tooltip/popover details

Status: **Done**

- [x] Done - Add a small warning badge interaction on HTTP node header.
- [x] Done - Show popover content: warning reason, refresh timestamp, and source Swagger URL.
- [x] Done - Ensure popover works in light/dark mode and on small screens.
- [x] Done - Keep interaction non-blocking (hover/focus/click accessible behavior).

### Phase 2 test and commit (required before Phase 3)

- [x] Done - Frontend build passes.
- [x] Done - Manual QA: badge opens details and displays timestamp + URL correctly.
- [x] Done - Manual QA: keyboard accessibility (focus and escape/outside close behavior).
- [x] Done - Commit Phase 2 only.

Execution log (Phase 2):

- [x] Done - `01df7f1` HTTP node warning badge interaction + details popover.
- [x] Done - `767455c` phase 2 learnings added.

Suggested commands:

```bash
cd frontend && npm run build
git add -A
git commit -m "feat: show swagger warning details in node popover"
```

---

## Phase 3 - Add "Refresh now" near environment selector

Status: **Done**

- [x] Done - Add a "Refresh now" control in canvas toolbar near environment selector.
- [x] Done - Reuse the same refresh pipeline used on workspace/environment load.
- [x] Done - Add loading/disabled state while refresh is running.
- [x] Done - Show success/error toast with endpoint count or failure reason.
- [x] Done - Keep behavior deterministic (manual refresh should not duplicate groups or warnings).

### Phase 3 test and commit (required before Phase 4)

- [x] Done - Frontend build passes.
- [x] Done - Manual QA: clicking "Refresh now" updates Add Nodes without reopening workspace.
- [x] Done - Manual QA: repeated clicks do not duplicate palette groups.
- [x] Done - Commit Phase 3 only.

Execution log (Phase 3):

- [x] Done - `e97ea89` manual Swagger refresh control + shared refresh pipeline.
- [x] Done - `ad03e01` phase 3 learnings added.

Suggested commands:

```bash
cd frontend && npm run build
git add -A
git commit -m "feat: add manual swagger refresh action in canvas toolbar"
```

---

## Phase 4 - Final regression and cleanup

Status: **Not done**

- [ ] Not done - Verify environment create/edit/duplicate keeps Swagger URL correctly.
- [ ] Not done - Verify warning behavior across workflow reload, tab switch, and environment switch.
- [ ] Not done - Verify collection import/export keeps `swaggerDocUrl`.
- [ ] Not done - Update docs/changelog notes for new behavior.

### Phase 4 test and commit (required before merge)

- [ ] Not done - Backend compile checks pass.
- [ ] Not done - Frontend build passes.
- [ ] Not done - Manual end-to-end QA pass complete.
- [ ] Not done - Commit Phase 4 only.

Suggested commands:

```bash
python -m compileall backend/app
cd frontend && npm run build
git add -A
git commit -m "chore: finalize swagger env sync regressions and docs"
```

---

## Completion Gate

- [ ] Not done - Every phase has tests executed.
- [ ] Not done - Every phase has its own commit.
- [ ] Not done - No open regressions in environment sync, node warnings, or toolbar actions.
