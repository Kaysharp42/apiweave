# Frontend UX Rework Plan

Objective: improve the APIWeave frontend workflow/collection experience without changing the core product behavior (visual API flow authoring, import/export, organization, and execution).

## Phase 1 - Import flow opens to Import tab
Status: Not done

- [x] Update `frontend/src/components/WorkflowExportImport.jsx` to support an explicit initial tab (`import` or `export`).
- [x] Wire `frontend/src/components/layout/SidebarHeader.jsx` import button path to open Workflow Export/Import directly on Import tab.
- [x] Keep export entry points (row export buttons) defaulting to Export tab.
- [x] Add/adjust tests for tab initialization behavior and reopening behavior.
- [ ] Run checks after this phase: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit this phase after tests pass.

## Phase 2 - Add delete for workflows and collections
Status: Not done

- [x] Add workflow delete action in `frontend/src/components/layout/Sidebar.jsx` with strong confirmation (explicit irreversible warning).
- [x] Add collection delete action in `frontend/src/components/layout/Sidebar.jsx` with strong confirmation (explicit irreversible warning).
- [x] Deletion behavior decision: permanently delete workflows from both Workflows view and Collections view.
- [x] Use existing backend endpoints: `DELETE /api/workflows/{workflow_id}` and `DELETE /api/collections/{collection_id}`.
- [x] Refresh sidebar state and close active tab if the deleted workflow is currently open.
- [ ] Add/adjust tests for delete handlers (success, cancellation, error toast path).
- [ ] Run checks after this phase: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit this phase after tests pass.

## Phase 3 - Rework workflows/collections left panel layout
Status: Not done

- [x] Redesign row layout so actions never push content off-screen (fixed action area + no horizontal overflow).
- [x] Truncate long workflow/collection names with ellipsis and show full value via tooltip on hover/focus.
- [x] Normalize spacing, hover states, and selected states for a modern, consistent list experience.
- [x] Ensure metadata badges wrap safely and never force horizontal scrolling.
- [x] Add/adjust tests for truncation utility/render logic and long-name edge cases.
- [ ] Run checks after this phase: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit this phase after tests pass.

## Phase 4 - Improve "Filter nodes" behavior
Status: Not done

- [x] Update `frontend/src/components/AddNodesPanel.jsx` so node filter text clears when users leave/close the panel.
- [x] Add a subtle inline clear (`x`) control inside the filter input.
- [x] Keep keyboard behavior intuitive (Escape or close interaction clears state consistently).
- [ ] Add/adjust tests for filter clear behavior and clear-button behavior.
- [ ] Run checks after this phase: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit this phase after tests pass.

## Phase 5 - Fix panel show/collapse FAB icon and positioning
Status: Not done

- [x] Replace the current settings icon for the panel toggle FAB with an icon that clearly communicates panel show/collapse.
- [x] Move FAB inward from screen edges and validate spacing on desktop and mobile.
- [x] Ensure FAB does not collide visually with minimap/other floating actions.
- [ ] Add/adjust tests for any extracted positioning/icon helper logic.
- [ ] Run checks after this phase: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit this phase after tests pass.

## Phase 6 - Final UX polish and regression pass
Status: Not done

- [ ] Run an end-to-end manual QA pass for workflows, collections, import/export, node filter, and panel toggle behaviors.
- [ ] Verify keyboard accessibility (tab order, Enter/Space activation, Escape/close behavior) for new controls.
- [ ] Update any user-facing docs/screenshots if UI behaviors changed materially.
- [ ] Run final checks: `npm run lint`, `node --test "src/**/*.test.js"`, `npm run build`.
- [ ] Commit final polish/fixes after tests pass.
