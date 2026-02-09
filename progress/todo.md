# APIWeave UI/UX Full Redesign — Master Plan

> **Created:** 2026-02-09
> **Reference:** FlowTest (FlowTestAI/FlowTest) UI/UX patterns
> **Scope:** Full redesign — new design system, DaisyUI adoption, Atomic Design, Zustand migration, all components restyled
> **Estimated Phases:** 10 | **Estimated Duration:** 4–6 weeks

---

## Overview

This plan transforms APIWeave's frontend from raw Tailwind utility classes with inconsistent patterns into a polished, design-system-driven UI inspired by FlowTest's mature UI/UX. Each phase is self-contained and shippable.

### Key Design Decisions
- **Component Library:** DaisyUI (Tailwind plugin) — matches FlowTest, adds tabs/menus/modals/buttons out-of-box
- **Architecture:** Atomic Design (atoms → molecules → organisms → pages)
- **Node Rendering:** Shared BaseNode wrapper for consistent look
- **State Management:** Migrate 12+ window.dispatchEvent() calls to Zustand stores
- **Icons:** Consolidate to lucide-react (modern, tree-shakeable, consistent)
- **Fonts:** Open Sans (body) + Montserrat (headings) — following FlowTest's typography
- **Color System:** Custom design tokens in Tailwind config with semantic naming

---

## Phase 1: Design Foundation — Tailwind Config, DaisyUI, Design Tokens

Establish the visual foundation that every subsequent phase builds on.

### Checklist

- [x] Install DaisyUI (`npm install daisyui`)
- [x] Add DaisyUI to `tailwind.config.js` plugins
- [x] Configure DaisyUI with custom light + dark themes (cyan-900 primary)
- [x] Define custom color tokens in Tailwind `extend.colors`:
  - `primary` → cyan-900 (#164e63)
  - `primary-light` → cyan-700
  - `surface` → slate-50 (light) / gray-900 (dark)
  - `surface-raised` → white (light) / gray-800 (dark)
  - `surface-overlay` → slate-100 (light) / gray-850 (dark)
  - `border-default` → slate-300 (light) / gray-700 (dark)
  - `text-primary` → gray-900 (light) / gray-100 (dark)
  - `text-secondary` → gray-600 (light) / gray-400 (dark)
  - `text-muted` → gray-400 (light) / gray-600 (dark)
  - `status-success` → green-600
  - `status-error` → red-600
  - `status-warning` → amber-500
  - `status-running` → yellow-500
- [x] Import Google Fonts (Open Sans + Montserrat) in `index.html`
- [x] Add `fontFamily` to Tailwind config: `sans: ['Open Sans']`, `display: ['Montserrat']`
- [x] Create `src/styles/base.css` with CSS custom properties for DaisyUI theme overrides
- [x] Update `index.css` to import base styles and remove hardcoded ReactFlow overrides (migrate to token-based)
- [x] Remove old ad-hoc `width` hacks from Tailwind config (`'8': '30px'` etc.), replace with semantic names (`nav-collapsed`, `nav-expanded`)
- [x] Verify dark mode toggle still works with DaisyUI themes
- [x] Document the design tokens in a `DESIGN_SYSTEM.md` file

### Testing & Commit
```
# Verify the app loads with no visual regressions
npm run dev → visual check: canvas, sidebar, header, dark mode toggle
# Run lint
npm run lint
# Commit
git add -A
git commit -m "phase-1: design foundation — DaisyUI, design tokens, typography"
```

---

## Phase 2: Atomic Design File Structure + Shared Primitives

Reorganize components into Atomic Design hierarchy and build the primitive atoms.

### Checklist

- [x] Create new directory structure:
  ```
  src/components/
    atoms/           — Button, Badge, Input, TextArea, IconButton, Divider, Tooltip, Toggle, Spinner
    atoms/flow/      — BaseNode, NodeHandle, NodeDivider
    molecules/       — SearchInput, KeyValueEditor, StatusBadge, ConfirmDialog, EmptyState
    organisms/       — (existing complex components, moved in Phase 5+)
    pages/           — (existing pages)
    layouts/         — (existing layouts)
  ```
- [x] Create `atoms/Button.jsx` — DaisyUI `btn` with intent variants (primary/secondary/success/error/warning/ghost), sizes (xs/sm/md/lg), loading state
- [x] Create `atoms/Badge.jsx` — DaisyUI `badge` with color variants
- [x] Create `atoms/Input.jsx` — DaisyUI `input` with label, error state, helper text
- [x] Create `atoms/TextArea.jsx` — DaisyUI `textarea` with auto-resize
- [x] Create `atoms/IconButton.jsx` — Icon-only button with tooltip (replaces scattered icon+onClick patterns)
- [x] Create `atoms/Divider.jsx` — Horizontal/vertical divider component
- [x] Create `atoms/Tooltip.jsx` — Wrapper around Tippy.js with consistent styling
- [x] Create `atoms/Toggle.jsx` — DaisyUI `toggle` for boolean settings (replaces custom toggles)
- [x] Create `atoms/Spinner.jsx` — DaisyUI `loading` with size variants
- [x] Create `atoms/flow/BaseNode.jsx` — Shared node shell (border, title bar with icon+label+status, content area, handles). Inspired by FlowTest's `FlowNode.js`
- [x] Create `atoms/flow/NodeHandle.jsx` — Styled ReactFlow handle (rectangular like FlowTest, color-coded)
- [x] Create `molecules/ConfirmDialog.jsx` — Replace all `window.confirm()` / `window.alert()` with styled DaisyUI modal
- [x] Create `molecules/EmptyState.jsx` — Reusable empty state with icon, title, description, optional CTA button (inspired by FlowTest's `EmptyWorkSpaceContent`)
- [x] Create `molecules/KeyValueEditor.jsx` — Reusable key-value pair table (used by headers, env vars, extractors)
- [x] Create `molecules/StatusBadge.jsx` — Execution status indicator (running/success/fail/pending)
- [x] Export all atoms from `atoms/index.js` barrel file
- [x] Export all molecules from `molecules/index.js` barrel file

### Testing & Commit
```
# Create a temporary Storybook-like test page (or visual test route) to render each atom in isolation
# Verify: Button variants, Badge colors, Input states, BaseNode rendering, ConfirmDialog
npm run dev → /test-atoms (temporary route)
npm run lint
git add -A
git commit -m "phase-2: atomic design primitives — atoms, molecules, BaseNode wrapper"
```

---

## Phase 3: Icon Consolidation + Toast System

Eliminate icon inconsistency and replace the fragile custom Toaster.

### Checklist

- [x] Audit all icon imports across all 49+ JSX files (grep for `react-icons`, `lucide-react`, `@heroicons`)
- [x] Create an icon mapping file `src/utils/icons.js` that re-exports canonical icons from `lucide-react`:
  ```js
  // Centralized icon exports — change source here, updates everywhere
  export { Home, FolderOpen, Play, Plus, Trash2, X, Settings, ... } from 'lucide-react';
  ```
- [x] Replace all `react-icons` imports (MdXxx, BsXxx, BiXxx, HiXxx, AiXxx) with lucide equivalents across all components
- [x] Replace all `@heroicons/react` imports with lucide equivalents
- [x] Remove `react-icons` and `@heroicons/react` from `package.json`
- [x] Install `react-hot-toast` or `sonner` (modern toast library):
  - `npm install sonner` (preferred — lightweight, beautiful defaults, dark mode support)
- [x] Create `atoms/Toast.jsx` wrapper around sonner with APIWeave styling
- [x] Replace all custom `Toaster.jsx` event dispatches (`window.dispatchEvent(new CustomEvent('toast', ...))`) with direct `toast.success()` / `toast.error()` calls
- [x] Remove old `Toaster.jsx` component
- [x] Verify all icons render correctly in both light and dark mode

### Testing & Commit
```
# Grep for any remaining react-icons or heroicons imports
grep -r "react-icons\|@heroicons" src/
# Visual check: all icons visible, no broken imports
# Test toast notifications: trigger success/error/info toasts
npm run lint
git add -A
git commit -m "phase-3: icon consolidation (lucide-react) + sonner toast system"
```

---

## Phase 4: Layout Overhaul — Header, Footer, NavBar, SplitPane

Redesign the outer shell to match FlowTest's polished IDE layout.

### Checklist

- [x] **MainHeader.jsx** redesign:
  - [x] Left: Logo + "APIWeave" wordmark (Montserrat display font)
  - [x] Center: (empty, or future breadcrumb)
  - [x] Right: Environment dropdown (DaisyUI select), Auto-save toggle (DaisyUI toggle), Dark mode toggle (DaisyUI swap icon), User avatar placeholder
  - [x] Use DaisyUI `navbar` component as base
  - [x] Height: consistent 48px, borders using design tokens
- [x] **MainFooter.jsx** redesign:
  - [x] Left: Version tag (DaisyUI badge)
  - [x] Center: Status indicator (Ready / Running / Error)
  - [x] Right: Collapse sidebar toggle, GitHub link icon
  - [x] Use `bg-surface` classes, 32px height
- [x] **AppNavBar.jsx** redesign:
  - [x] Match FlowTest: vertical icon rail with cyan-900 active indicator bar (4px left border)
  - [x] Collapse/expand with smooth Headless UI Transition (labels slide in/out)
  - [x] Items: Workflows (default), Collections, Webhooks, Settings (disabled badge "Soon")
  - [x] Collapsed width: 56px (icon-only) with tooltips
  - [x] Expanded width: 180px (icon + label)
  - [x] Use design token colors, lucide icons
- [x] **MainLayout.jsx** — update Allotment constraints:
  - [x] Left pane: min 56px (collapsed), preferred 450px, max 600px
  - [x] Separator visible/disabled state based on collapse
  - [x] Smooth transition when collapsing
- [x] **Home.jsx** — add conditional layout: show `WithoutSidebar` variant when no workflows exist (like FlowTest's pattern)
- [x] Add `HorizontalDivider` atom if not already present (consistent 1px border)

### Testing & Commit
```
# Visual check: header, footer, nav bar in expanded/collapsed state
# Test: dark mode toggle, collapse/expand, navigation between views
# Test: responsive behavior at different window sizes
npm run lint
git add -A
git commit -m "phase-4: layout overhaul — header, footer, nav bar, split panes"
```

---

## Phase 5: Sidebar Redesign

Transform the sidebar into a polished file-explorer style panel.

### Checklist

- [x] **SidebarHeader** redesign:
  - [x] Breadcrumb-style header: "My Workspace > Workflows" (dynamic based on nav selection)
  - [x] Action buttons (New + Import) as DaisyUI `btn-ghost btn-sm` with lucide icons
  - [x] Use `molecules/SearchInput.jsx` for sidebar search/filter
- [x] **Workflows view** redesign:
  - [x] DaisyUI `menu` tree structure (like FlowTest's `Collection.js`)
  - [x] Each workflow item: file icon, name, node count badge, collection badge, env badge
  - [x] Hover state: subtle background + export/delete action icons appear
  - [x] Selection state: `bg-primary/10` with left border accent
  - [ ] Add loading skeleton states (DaisyUI `skeleton`) during fetch *(deferred — Spinner used instead)*
  - [x] Virtual scrolling for large lists (or intersection observer for pagination)
- [x] **Collections view** redesign:
  - [x] Collapsible tree: DaisyUI `collapse` or `menu` with nested items
  - [x] Collection header: folder icon, name, workflow count badge, chevron
  - [x] Nested workflow items indented with vertical guide lines (CSS `before:` pseudo like FlowTest)
  - [ ] Context menu on right-click (or 3-dot menu) for CRUD actions *(deferred to Phase 9)*
- [x] **Webhooks view**: Keep WebhookManager inline but restyle with DaisyUI components
- [x] **Settings view**: Design placeholder with actual setting categories (General, Editor, Theme, About)
- [x] Add **empty states** using `molecules/EmptyState.jsx`:
  - [x] Workflows: illustration + "No workflows yet" + "Create your first workflow" CTA button
  - [x] Collections: illustration + "No collections yet" + CTA
- [x] Replace `window.dispatchEvent('workflowsNeedRefresh')` with Zustand store action (partial event migration)

### Testing & Commit
```
# Test: navigate between all 4 sidebar views
# Test: create/delete workflow from sidebar, verify refresh
# Test: collection expand/collapse, workflow nesting
# Test: empty states when no data exists
# Test: dark mode for all sidebar states
npm run lint
git add -A
git commit -m "phase-5: sidebar redesign — tree browser, empty states, DaisyUI menus"
```

---

## Phase 6: Tab System + Workspace Chrome

Add a proper tab management system and polish the workspace area.

### Checklist

- [x] Create `organisms/TabBar.jsx`:
  - [x] DaisyUI `tabs tabs-boxed` or custom styled tabs
  - [x] Tab shows: workflow name + unsaved indicator (*) + close button (×)
  - [x] Active tab: `bg-primary text-white`, inactive: `bg-surface` with hover state
  - [x] Middle-click to close tab
  - [x] Tab overflow: scroll with left/right chevron buttons
  - [x] **Tab context menu** (right-click): Close, Close Others, Close All
- [x] Create `TabStore.js` (Zustand):
  - [x] `tabs[]` — open tab list with `{ id, workflowId, name, isDirty }`
  - [x] `activeTabId` — currently focused tab
  - [x] `openTab(workflow)`, `closeTab(id)`, `setActive(id)`, `markDirty(id)`, `markClean(id)`
  - [x] `closeOthers(id)`, `closeAll()`
- [x] Wire tab bar into `Workspace.jsx`:
  - [x] Tab bar above the canvas
  - [x] Switching tabs loads the corresponding workflow
  - [x] Closing last tab shows workspace empty state
- [x] Create `molecules/WorkspaceEmptyState.jsx`:
  - [x] Large centered content: "Welcome to APIWeave"
  - [x] Quick actions: "New Workflow", "Import Workflow", "Open Collection"
  - [x] Keyboard shortcuts hint
- [x] Add `Ctrl+W` keyboard shortcut to close active tab
- [x] Add `Ctrl+Tab` / `Ctrl+Shift+Tab` to cycle tabs
- [x] Track unsaved changes: asterisk (*) in tab name when workflow has pending auto-save

### Testing & Commit
```
# Test: open multiple workflows as tabs, switch between them
# Test: close tabs (button, middle-click, Ctrl+W)
# Test: unsaved indicator appears/disappears
# Test: empty workspace state when all tabs closed
# Test: tab context menu actions
npm run lint
git add -A
git commit -m "phase-6: tab system + workspace chrome — TabStore, TabBar, empty state"
```

---

## Phase 7: Node Redesign — BaseNode + All Node Types

Restyle every node using the shared BaseNode wrapper.

### Checklist

- [x] **BaseNode wrapper** (`atoms/flow/BaseNode.jsx`) — finalize:
  - [x] `rounded-lg border-2 shadow-sm bg-surface-raised`
  - [x] Title bar: icon (per node type) + editable label + status dot + collapse toggle
  - [x] Content area: `p-3` with consistent spacing
  - [x] Selected state: `ring-2 ring-primary` 
  - [x] Running state: pulsing border animation
  - [x] Error state: `border-status-error` with subtle red glow
  - [x] Success state: `border-status-success`
  - [x] Dark mode: proper token-based colors
- [x] **StartNode.jsx** redesign:
  - [x] Pill/circle shape with play icon, green gradient
  - [x] Single right handle
- [x] **EndNode.jsx** redesign:
  - [x] Pill/circle shape with stop icon, red gradient
  - [x] Single left handle
- [x] **HTTPRequestNode.jsx** redesign (most complex):
  - [x] Use BaseNode wrapper
  - [x] Method badge (GET=green, POST=blue, PUT=orange, DELETE=red, PATCH=purple)
  - [x] Compact URL display with truncation
  - [x] Expand/collapse for details (headers count, body indicator, extractor count)
  - [x] Inline mini response preview (status code + time) when executed
  - [x] Limit visible node width to `max-w-80` for canvas cleanliness
- [x] **AssertionNode.jsx** redesign:
  - [x] Use BaseNode wrapper
  - [x] Two output handles: Pass (green, right-top) + Fail (red, right-bottom) — keep existing dual-output
  - [x] Compact assertion summary display
  - [x] Pass/fail status clearly visible
- [x] **DelayNode.jsx** redesign:
  - [x] Use BaseNode wrapper with clock icon
  - [x] Clean duration display (e.g., "500ms")
- [x] **MergeNode.jsx** redesign:
  - [x] Use BaseNode wrapper with merge icon
  - [x] Multiple left handles, single right handle
- [x] **Custom edges**: Restyle to match — smooth step paths (like FlowTest), delete button at midpoint, animated edges during execution
- [x] Update `AddNodesPanel.jsx` drag preview to match new node style
- [x] Update `NodeModal.jsx` to use design system atoms (Button, Input, etc.) for the full edit experience

### Testing & Commit
```
# Test: create each node type, verify rendering (light + dark)
# Test: drag-and-drop nodes onto canvas
# Test: connect nodes with edges, verify handles
# Test: run a workflow, verify status states (running, success, fail)
# Test: expand/collapse HTTP node details
# Test: double-click to open NodeModal for each type
npm run lint
git add -A
git commit -m "phase-7: node redesign — BaseNode wrapper, all 6 node types restyled"
```

---

## Phase 8: Modals & Panels Overhaul

Replace all modals with consistent, polished DaisyUI-based dialogs.

### Checklist

- [x] Create `molecules/Modal.jsx` — shared modal shell:
  - [x] DaisyUI `modal` with Headless UI `Dialog` for accessibility
  - [x] Sizes: sm (max-w-md), md (max-w-2xl), lg (max-w-4xl), xl (max-w-6xl), fullscreen
  - [x] Consistent header (title + close button), body (scrollable), footer (action buttons)
  - [x] Overlay click to close, Escape key to close
  - [x] Entrance animation (fade + scale)
- [x] Refactor **NodeModal.jsx**:
  - [x] Use shared Modal shell (xl size) — Headless UI Dialog/Transition wrapper on shell
  - [ ] Split 1383-line monolith into sub-components *(deferred — too risky this phase, shell accessibility is the priority win)*
  - [x] Replace inline inputs with design system atoms (design tokens applied to shell)
- [x] Refactor **EnvironmentManager.jsx**:
  - [x] Use shared Modal shell (lg size)
  - [x] Use `molecules/KeyValueEditor.jsx` for variables
  - [x] DaisyUI form inputs throughout
- [x] Refactor **CollectionManager.jsx**: Use shared Modal, DaisyUI form inputs
- [x] Refactor **WorkflowJsonEditor.jsx**: Use Headless UI Dialog/Transition, design tokens
- [x] Refactor **WebhookManager.jsx**: Use Modal + ConfirmDialog, DaisyUI cards/tables/forms, toast
- [x] Replace **all remaining `window.confirm()`** calls with `molecules/ConfirmDialog.jsx`
- [x] Refactor **SecretsPrompt.jsx**: Use shared Modal, DaisyUI form, design tokens
- [x] Refactor **SecretsPanel.jsx**: Use shared Modal, DaisyUI form inputs, design tokens
- [x] Add **side sheet / sliding panel** pattern (like FlowTest's FlowLogs):
  - [x] Built custom `molecules/SlidePanel.jsx` with Headless UI Dialog + Transition
  - [x] Configurable side (left/right), size (sm/md/lg), optional footer
- [x] Refactor **DynamicFunctionsHelper.jsx**: Use DaisyUI `collapse` for categories, toast for copy

### Testing & Commit
```
# Test: open every modal (NodeModal, EnvironmentManager, CollectionManager, etc.)
# Test: modal accessibility — Escape to close, overlay click, focus trapping
# Test: confirm dialogs on delete actions (workflows, environments, nodes)
# Test: secrets prompt on load
# Test: dark mode for all modals
npm run lint
git add -A
git commit -m "phase-8: modals & panels overhaul — shared Modal, split NodeModal, DaisyUI forms"
```

---

## Phase 9: State Management Migration — Events to Zustand

Replace fragile window.dispatchEvent() pattern with proper Zustand stores.

### Checklist

- [x] ~~Create `stores/WorkflowListStore.js`~~ (Covered by existing SidebarStore — see learnings #60):
  - [x] `workflows[]`, `collections[]`, `loading`, `error`
  - [x] `fetchWorkflows()`, `createWorkflow()`, `deleteWorkflow()`, `refreshWorkflows()`
  - [x] Replaces: `workflowsNeedRefresh`, `collectionsChanged` events
- [x] ~~Create `stores/EnvironmentStore.js`~~ (Covered by SidebarStore `environmentVersion` — see learnings #60):
  - [x] `environments[]`, `activeEnvironment`, `secrets{}`
  - [x] `fetchEnvironments()`, `setActive()`, `updateSecrets()`
  - [x] Replaces: `environmentsChanged` event
- [x] Create `stores/CanvasStore.js`:
  - [x] `clipboard`, `pendingAction` (duplicate/copy/paste)
  - [x] `copyNode()`, `pasteNode()`, `duplicateNode()`, `signalWorkflowReload()`
  - [x] Replaces: `duplicateNode`, `copyNode`, `pasteNode`, `workflowUpdated` events
- [x] ~~Create `stores/VariableStore.js`~~ (Kept in WorkflowContext — per-workflow scope — see learnings #61):
  - [x] `variables{}`, `extractors[]`
  - [x] `updateVariable()`, `deleteVariable()`, `registerExtractors()`
  - [x] Replaces: `variableDeleted`, `variablesToUpdate`, `extractorDeleted`, `workflowUpdated` events
- [x] Refactor `WorkflowCanvas.jsx`:
  - [x] Extract clipboard logic (copy/paste) into CanvasStore
  - [x] Extract polling logic into a custom hook `useWorkflowPolling.js`
  - [x] Extract auto-save logic into a custom hook `useAutoSave.js`
  - [x] Extract drag-and-drop logic into a custom hook `useCanvasDrop.js`
  - [x] Target: reduce 1541 lines to ~500 lines → achieved 937 lines (39% reduction)
- [x] Replace **all** `window.dispatchEvent()` calls with direct Zustand store actions
- [x] Replace **all** `window.addEventListener()` listeners with Zustand `subscribe()` or `useStore()` hooks
- [x] Verify no `CustomEvent` usage remains: `grep -r "CustomEvent\|dispatchEvent\|addEventListener.*custom" src/`
- [x] Keep WorkflowContext for per-workflow state (variables, settings) — it's correct for that scope
- [x] PaletteContext unchanged — no event-based patterns found

### Testing & Commit
```
# Critical: test all cross-component interactions that previously used events
# Test: create workflow → sidebar updates immediately (no event)
# Test: delete workflow → sidebar updates, tab closes
# Test: copy/paste nodes between workflows
# Test: change environment → all subscribers update
# Test: run workflow → polling works, results display
# Test: auto-save still works with 700ms debounce
# Run full manual regression test of all features
npm run build    # ✅ verified — vite build succeeds
git add -A
git commit -m "phase-9: state migration — Zustand stores replace window events, canvas decomposition"
```

---

## Phase 10: Canvas Toolbar, Keyboard Shortcuts, Polish & Accessibility

Final polish pass — toolbar redesign, keyboard shortcuts, accessibility, animations.

### Checklist

- [ ] **Canvas Toolbar** redesign:
  - [ ] Floating toolbar bar (horizontal, centered-top or top-right)
  - [ ] DaisyUI `btn-group` for: Run ▶ | Save | History | JSON | Import
  - [ ] Environment selector integrated in toolbar (DaisyUI select)
  - [ ] Execution status in toolbar: spinner during run, checkmark on success, X on failure
  - [ ] Zoom controls moved to bottom-left (like FlowTest)
  - [ ] MiniMap toggle button
- [ ] **Add Nodes Panel** redesign:
  - [ ] Use Headless UI Popover opening upward from FAB (like FlowTest)
  - [ ] Search/filter input at top
  - [ ] DaisyUI `collapse` sections: HTTP Requests, Control Flow, Validation, Imported
  - [ ] Drag-and-drop with visual preview
- [ ] **Keyboard shortcuts**:
  - [ ] `Ctrl+N` — New workflow
  - [ ] `Ctrl+S` — Save (with visual feedback even though auto-save is on)
  - [ ] `Ctrl+R` / `F5` — Run workflow
  - [ ] `Ctrl+W` — Close active tab
  - [ ] `Ctrl+Tab` / `Ctrl+Shift+Tab` — Cycle tabs
  - [ ] `Ctrl+E` — Toggle environment manager
  - [ ] `Ctrl+J` — Toggle JSON editor
  - [ ] `Ctrl+B` — Toggle sidebar collapse
  - [ ] `Delete` / `Backspace` — Delete selected nodes
  - [ ] `?` — Show keyboard shortcuts help panel
  - [ ] Install `mousetrap` for keybinding: `npm install mousetrap`
- [ ] Create **Keyboard Shortcuts Help** panel (DaisyUI modal, triggered by `?`)
- [ ] **Loading states**:
  - [ ] DaisyUI `skeleton` components for sidebar items while fetching
  - [ ] Skeleton for workflow canvas while loading
  - [ ] Pulse animation on Run button during execution
- [ ] **Transitions & Animations**:
  - [ ] Sidebar collapse: smooth width transition
  - [ ] Modal enter/exit: scale + fade (Headless UI Transition)
  - [ ] Toast enter: slide from right
  - [ ] Tab switch: subtle opacity transition
  - [ ] Node drag: drop shadow on pickup
- [ ] **Accessibility (a11y)**:
  - [ ] All interactive elements have proper `aria-label`
  - [ ] Modal focus trapping (Headless UI Dialog provides this)
  - [ ] Color contrast check: ensure all text on design tokens passes WCAG AA
  - [ ] Keyboard navigation: tab through toolbar, sidebar, modals
  - [ ] Screen reader text for status indicators
- [ ] **Final cleanup**:
  - [ ] Remove unused components (`WorkflowList.jsx` page if unused)
  - [ ] Remove orphaned CSS classes
  - [ ] Consistent file naming: all components PascalCase, all utils camelCase
  - [ ] Update all `import` paths to use barrel files (`atoms/index.js`, etc.)
  - [ ] Run Prettier across entire frontend: `npm run format`
- [ ] Update `README.md` with new screenshots
- [ ] Update `DESIGN_SYSTEM.md` with final component inventory

### Testing & Commit
```
# Full regression test:
#   1. Create a workflow with all 6 node types
#   2. Connect nodes, run workflow, verify results
#   3. Test all keyboard shortcuts
#   4. Test dark mode end-to-end
#   5. Test all modals open/close correctly
#   6. Test sidebar navigation (all 4 views)
#   7. Test tab management (open, close, switch, dirty indicator)
#   8. Test collections: create, add workflows, export, import
#   9. Test environments: create, assign, switch, verify substitution
#  10. Test empty states (new install with no data)
#  11. Accessibility: keyboard-only navigation through main flows
npm run lint
npm run format
npm run build  # Ensure production build succeeds
git add -A
git commit -m "phase-10: polish — toolbar, keyboard shortcuts, a11y, animations, final cleanup"
```

---

## Phase Summary Table

| Phase | Focus Area | Key Deliverables | Risk |
|-------|-----------|-----------------|------|
| 1 | Design Foundation | DaisyUI, tokens, fonts | Low |
| 2 | Atomic Primitives | Button, Input, BaseNode, ConfirmDialog, EmptyState | Low |
| 3 | Icons + Toasts | lucide-react consolidation, sonner toasts | Low |
| 4 | Layout Shell | Header, Footer, NavBar, SplitPane | Medium |
| 5 | Sidebar | Tree browser, empty states, search | Medium |
| 6 | Tab System | TabBar, TabStore, workspace empty state | Medium |
| 7 | Nodes | BaseNode wrapper, all 6 types, edges, AddNodesPanel | High |
| 8 | Modals & Panels | Shared Modal, NodeModal split, all dialogs | High |
| 9 | State Management | Zustand stores, event removal, canvas decomposition | **Critical** |
| 10 | Polish | Toolbar, shortcuts, a11y, animations, cleanup | Medium |

---

## Dependencies Between Phases

```
Phase 1 (tokens) ──→ ALL subsequent phases depend on this
Phase 2 (atoms)  ──→ Phases 4-10 use these components
Phase 3 (icons)  ──→ Independent, can run parallel with Phase 2
Phase 4 (layout) ──→ Phase 5 (sidebar), Phase 6 (tabs)
Phase 5 (sidebar) ─→ Phase 9 (store migration — sidebar events)
Phase 6 (tabs)   ──→ Phase 9 (TabStore)
Phase 7 (nodes)  ──→ Phase 8 (NodeModal uses new node components)
Phase 9 (state)  ──→ Must come after Phases 4-8 (components must exist first)
Phase 10 (polish) ─→ Final pass, after everything else
```

**Phases 2 & 3 can run in parallel.**
**Phases 4, 5, 6 are sequential.**
**Phase 7 can start after Phase 2.**
**Phase 8 requires Phase 2 + Phase 7.**

---

## Rollback Strategy

Each phase is committed independently. If a phase introduces regressions:
1. `git log --oneline` to find the phase commit
2. `git revert <commit-hash>` to undo
3. Fix issues on a branch, then re-merge

---

## Reference: FlowTest Patterns Adopted

| FlowTest Pattern | APIWeave Adoption |
|-----------------|-------------------|
| DaisyUI component library | Phase 1 |
| Atomic Design (atoms/molecules/organisms) | Phase 2 |
| Shared FlowNode wrapper | Phase 2 + 7 |
| Custom color tokens + typography | Phase 1 |
| Vertical nav rail with left accent bar | Phase 4 |
| Tree-style sidebar with indent guides | Phase 5 |
| Collection-scoped tab system | Phase 6 |
| Color-coded method badges on nodes | Phase 7 |
| Smooth step edge paths with delete button | Phase 7 |
| Headless UI Dialog modals | Phase 8 |
| Zustand stores (CanvasStore, TabStore) | Phase 9 |
| Mousetrap keyboard bindings | Phase 10 |
| Floating Add Nodes popover | Phase 10 |
| Edge animation during execution | Phase 7 |
| Empty workspace CTAs | Phase 6 |
| Sliding side panels for logs | Phase 8 |
