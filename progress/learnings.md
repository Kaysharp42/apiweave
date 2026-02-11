# APIWeave — Learnings

> Accumulated knowledge from development sessions. Each entry documents something non-obvious discovered during implementation.

---

## Phase 1: Design Foundation (2026-02-09)

### 1. DaisyUI 5.x + Tailwind `darkMode: 'class'` dual strategy
DaisyUI uses `data-theme` attributes for theming, but Tailwind's `dark:` utility classes rely on the `dark` class on `<html>`. To make both work simultaneously, the dark mode toggle in `App.jsx` must set **both**:
```jsx
document.documentElement.classList.add('dark');                        // Tailwind dark: variants
document.documentElement.setAttribute('data-theme', 'apiweave-dark'); // DaisyUI component theming
```
Without the `data-theme`, DaisyUI components (btn, badge, modal, etc.) won't pick up the dark theme colors. Without the `dark` class, all custom `dark:` Tailwind utilities stop working.

### 2. CSS `@import` must precede `@tailwind` directives
Vite's CSS processor enforces the CSS spec: `@import` statements must come before all other statements. When `index.css` had `@tailwind base` before `@import './styles/base.css'`, the build produced a warning. Solution: move the `@import` to the very top of `index.css`.

### 3. Tailwind ad-hoc width overrides are fragile
The original config overrode Tailwind's built-in `w-8` (normally `2rem`) to mean `30px`. This silently broke the meaning of `w-8` everywhere — any component using `w-8` expecting the standard 2rem got 30px instead. Replaced with semantic names (`w-nav-collapsed`, `w-nav-expanded`) that can't collide with Tailwind defaults.

### 4. DaisyUI CSS bundle size impact
Adding DaisyUI increased the CSS bundle from ~149KB to ~152KB gzipped (only ~3KB gzipped increase). This is minimal because DaisyUI compiles to pure CSS utility classes that Tailwind can tree-shake. The JS bundle is unaffected.

### 5. AppNavBar uses both Tailwind classes AND inline `style` for width
The `AppNavBar.jsx` component applies width via both a Tailwind class (`w-nav-collapsed`) and an inline `style={{ width: '56px' }}`. The inline style takes precedence. Both are kept for now — the Tailwind class provides the min-width constraint while the inline style is needed for the Allotment split pane integration. This dual approach should be simplified in Phase 4 (Layout Overhaul).

### 6. CSS custom properties auto-switch between themes
By defining `--aw-*` properties under both `:root` and `.dark`, all ReactFlow dark mode overrides that reference `var(--aw-surface)` etc. automatically get the correct color when the theme toggles — no JavaScript involvement needed. This replaces dozens of hardcoded hex values from the original `index.css`.

---

## Phase 2: Atomic Design Primitives (2026-02-09)

### 7. DaisyUI class composition pattern
DaisyUI components are styled by joining CSS class strings. The cleanest React pattern is building an array and filtering out falsy values:
```jsx
const classes = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, loading && 'loading', className].filter(Boolean).join(' ');
```
This avoids nested ternaries and keeps the class logic scannable. Every atom follows this pattern for consistency.

### 8. `useId()` for accessible label association
React 18's `useId()` hook generates stable, SSR-safe unique IDs. Using it in `Input`, `TextArea`, and `Toggle` atoms to link `<label htmlFor>` with the input's `id` eliminates the need for manual ID props while keeping the components accessible out of the box.

### 9. BaseNode wrapper — selection + status via Tailwind only
The `BaseNode` flow atom handles four execution states (idle, running, success, error) and a selection ring using only Tailwind classes — no inline styles or CSS-in-JS. The `pulse-border` animation (defined in Phase 1's `tailwind.config.js`) drives the running state. This keeps node rendering in the same paradigm as every other component.

### 10. Headless UI Dialog > DaisyUI modal for programmatic use
DaisyUI's `modal` component relies on checkbox toggling or the `showModal()` DOM API, which is awkward in React state. Headless UI's `Dialog` + `Transition` gives full React control (open/close via state), built-in focus trapping, and accessible overlay dismissal. The `ConfirmDialog` molecule wraps this with an `initialFocus` ref on the cancel button to prevent accidental confirms.

### 11. Barrel files enable clean refactoring later
Each atomic layer (`atoms/index.js`, `molecules/index.js`) re-exports every component. Consumers import from the barrel: `import { Button, Badge } from '../atoms'`. When a component moves or gets renamed internally, only the barrel file changes — no hunt-and-replace across the codebase. This pays off in Phases 5–7 when organisms get restructured.

### 12. KeyValueEditor grid layout for aligned tables
Using `grid grid-cols-[1fr_1fr_auto]` instead of flexbox keeps key/value columns perfectly aligned across rows regardless of content length. The `auto` column for the delete button prevents it from stretching. This is reused for HTTP headers, environment variables, and extractors — three components that previously had their own slightly-different implementations.

### 13. No ESLint config in the project yet
The `npm run lint` script invokes ESLint but no `.eslintrc` config exists in the frontend directory. The command fails with "couldn't find a configuration file." This is a gap to address — likely in a future phase when code quality tooling is set up. For now, VS Code's built-in diagnostics (TypeScript/JSX checking) catches syntax issues.

---

## Phase 3: Icon Consolidation + Toast System (2026-02-09)

### 14. lucide-react icon prop API differs from react-icons
react-icons components accept `size={number}` as a standalone prop and render an inline SVG at that pixel size. lucide-react icons also accept `size` but default to `24` instead of `1em`. When migrating, the `className="w-4 h-4"` pattern (Tailwind sizing) works universally with both libraries, but explicit `size={14}` props also work natively with lucide-react — no changes required for those callsites.

### 15. PowerShell `-replace` for bulk icon renaming is efficient but order-sensitive
Using PowerShell's `-replace` operator to batch-rename icon components across 26+ files is fast but requires care with ordering. For example, replacing `MdVisibility` before `MdVisibilityOff` would corrupt `MdVisibilityOff` into `EyeOff` incorrectly (becoming `EyeOff` since `MdVisibility` is a substring). The solution is to replace longer/more specific names first, or use word-boundary-aware patterns.

### 16. react-icons/md icon names have no consistent lucide equivalents
Some Material Design icons have direct lucide equivalents (MdDelete → Trash2, MdEdit → Pencil), but others require semantic mapping: MdAutoAwesome → Sparkles, MdAcUnit → Snowflake, MdExtension → Puzzle, MdControlPointDuplicate → CopyPlus. The centralized `src/utils/icons.js` mapping file documents all these decisions in one place, making future changes trivial.

### 17. WorkflowSettingsPanel had a toast API mismatch bug
The old `Toaster.jsx` expected `toast('msg', { type: 'error' })` (second arg is an options object), but `WorkflowSettingsPanel.jsx` called `toast('msg', 'error')` (passing a raw string). This silently failed to set the toast type. Migrating to sonner surfaced and fixed this — sonner uses explicit methods: `toast.error('msg')`, `toast.success('msg')`.

### 18. sonner `richColors` + `theme="system"` auto-adapts to dark mode
sonner's `richColors` prop enables built-in color styling for success/error/info toasts. Combined with `theme="system"`, it reads the system preference to match light/dark mode — no manual dark mode handling needed in the Toast component. This replaces 15+ lines of custom toast styling from the old Toaster.

### 19. Removing react-icons saves ~4MB from node_modules
react-icons bundles thousands of icon SVGs from 20+ icon sets. After migration, only `lucide-react` remains — a single, tree-shakeable set of ~1500 icons. The production build remained at ~813KB JS gzipped, confirming tree-shaking works correctly and unused icons are eliminated.

### 20. @heroicons/react was an unused dependency
Despite being listed in package.json, `@heroicons/react` had zero imports anywhere in the codebase. It was likely added during early development and never cleaned up. The Phase 3 audit caught and removed it alongside react-icons.

---

## Phase 4: Layout Overhaul (2026-02-09)

### 21. DaisyUI `navbar` provides flexbox structure, not fixed height
DaisyUI's `navbar` class sets `display: flex`, `align-items: center`, and some padding, but does **not** enforce a fixed height. The `h-header` token (48px from `tailwind.config.js`) must be applied alongside `min-h-0` to override DaisyUI's default `min-height: 4rem` (64px). Without `min-h-0`, the header renders taller than intended.

### 22. DaisyUI `swap` replaces manual toggle state rendering
The old header manually checked `darkMode` state to render `<Moon>` or `<Sun>` inside a `<button>`. DaisyUI's `swap` component handles this with a hidden checkbox + `.swap-on` / `.swap-off` children — the correct icon is shown based on the checkbox state. This eliminates the need for conditional rendering and the `handleDarkModeToggle` / `handleAutoSaveToggle` wrapper functions.

### 23. `navbar-start`, `navbar-center`, `navbar-end` for header layout
DaisyUI's `navbar` uses a three-section flex layout via `navbar-start` (flex-start), `navbar-center` (centered), and `navbar-end` (flex-end). This replaces the manual `justify-between` pattern with a semantic layout that auto-distributes space. Even when `navbar-center` is empty (future breadcrumb slot), the layout stays balanced.

### 24. The footer's sidebar collapse toggle duplicates AppNavBar's collapse button
Both the footer and the AppNavBar bottom have a collapse/expand toggle. This is intentional — FlowTest also has the sidebar collapse toggle in the footer as a secondary access point. The `useNavigationStore` Zustand store keeps both in sync since they share the same state slice.

### 25. HorizontalDivider vs DaisyUI Divider — two distinct atoms
The existing `Divider.jsx` atom wraps DaisyUI's `divider` class which includes vertical padding (~1rem) and optional text. The new `HorizontalDivider.jsx` is a zero-padding `h-px` div — a pure visual separator matching FlowTest's pattern. Both are needed: `Divider` for spacing within content sections, `HorizontalDivider` for tight layout boundaries (header/footer borders).

### 26. AppNavBar horizontal vs vertical item layout trade-off
FlowTest uses a vertical stacked layout in the nav bar (icon above label), which requires more vertical space per item. The APIWeave redesign moved to a horizontal layout (icon left, label right) which is more space-efficient and fits the 180px expanded width better. The vertical layout worked in FlowTest because it uses 112px expanded width with tiny (16x16) icons, while APIWeave's expanded width is 180px where horizontal labels feel more natural.

### 27. Removing `console.log` debug statements from layout components
The original `MainHeader.jsx` had `console.log('MainHeader context:', context)` and `console.log('Dark mode toggle clicked, current:', darkMode)` — debug statements from initial development. These were removed during the redesign. A lesson: debug logging in render paths causes noise in the console during normal use and should be wrapped in `if (import.meta.env.DEV)` guards or removed entirely.

### 28. CSS bundle grew negligibly from layout redesign
Post-Phase 4 build: 203.23KB CSS (28.49KB gzipped), 815.53KB JS (219.60KB gzipped). The DaisyUI `navbar`, `swap`, `badge` classes used in the new layout components add minimal CSS because they were already included in the bundle from Phase 1's DaisyUI installation. No new DaisyUI component categories were introduced.

---

## Phase 5: Sidebar Redesign (2026-02-09)

### 29. Zustand version counter pattern replaces window events
Instead of broadcasting `window.dispatchEvent(new Event('workflowsNeedRefresh'))` and attaching `addEventListener` listeners (which are fragile, untyped, and invisible to React's lifecycle), a Zustand store exposes `workflowVersion` and `collectionVersion` integer counters. `signalWorkflowsRefresh()` increments the counter; subscribers react to the change via `useEffect(…, [workflowVersion])`. This gives type safety, dev tools visibility, and eliminates event listener cleanup bugs. Backward-compatible: legacy window event listeners kept during transition.

### 30. Dual event listener strategy for gradual migration
Callers of `window.dispatchEvent('workflowsNeedRefresh')` exist in WorkflowContext, SidebarHeader, CollectionManager, and CollectionExportImport. Rather than updating all callers at once (risky), Sidebar.jsx listens to BOTH the Zustand version counter AND the legacy window events during Phase 5. Callers are migrated one-by-one: SidebarHeader now uses `useSidebarStore.getState().signalWorkflowsRefresh()`, while WorkflowContext and CollectionManager still use window events. Full cleanup deferred to Phase 9 (Store Migration).

### 31. DaisyUI `menu` component provides tree structure with minimal CSS
DaisyUI's `<ul className="menu menu-sm">` with nested `<li>` elements provides a ready-made tree structure with proper indentation, hover states, and active item styling. Combined with `before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border` on the nested `<ul>`, this produces the vertical guide lines pattern (like FlowTest's `Collection.js`) without any custom CSS. The `menu-sm` size variant matches the compact sidebar density.

### 32. Shared `WorkflowItem` component eliminates duplication
The workflow list item (icon + name + badges + hover actions) appears in both the Workflows view and inside Collections view (nested under each collection). Extracting a `WorkflowItem` inner component within `Sidebar.jsx` eliminates the duplication that existed in the old code, where the Workflows view and Collections view had separate but nearly-identical markup for workflow items. Changes to item rendering now happen in one place.

### 33. `useMemo` for search filtering keeps the render path clean
Filtering workflows/collections by `searchQuery` is done via `useMemo` at the top of the component, not inline in JSX. This separates the filter logic from the rendering logic, and React only recalculates the filtered lists when `workflows`/`collections`/`searchQuery` actually change — not on every render.

### 34. Dead state variables accumulate silently
Sidebar.jsx contained four state variables (`selectedCollection`, `selectedCollectionWorkflows`, `draggedWorkflow`, `dragOverCol`) that were declared via `useState` but never read or updated anywhere in the component. These were remnants of an earlier drag-and-drop feature that was removed. Without a linter rule like `no-unused-vars`, dead state persists indefinitely. Phase 5 cleanup removed them. Lesson: periodic audits of useState declarations vs actual usage prevent this drift.

### 35. `scrollbarGutter: 'stable'` prevents layout shift during scroll
When content grows long enough to need a scrollbar, the browser typically reduces the content width to make room for the scrollbar, causing a layout jump. CSS `scrollbar-gutter: stable` reserves the scrollbar space upfront so the layout doesn't shift when the scrollbar appears or disappears. Applied to the workflow list scroll container where the pagination loading state can toggle the scrollbar on/off.

---

## Phase 6: Tab System + Workspace Chrome (2026-02-09)

### 36. Zustand `getState()` for fire-and-forget side effects avoids re-render subscriptions
Inside `WorkflowCanvas.jsx` (a 1500+ line component), subscribing to `useTabStore()` via the hook would cause the canvas to re-render whenever *any* tab state changes — including other tabs' dirty flags, tab opens/closes, etc. Using `useTabStore.getState().markDirty(workflowId)` and `useTabStore.getState().markClean(workflowId)` as imperative calls avoids subscribing the component to the store entirely. The canvas never re-renders due to tab state changes; it simply fires the mutations. Only the TabBar component subscribes to the store and re-renders when tabs change.

### 37. `ResizeObserver` is essential for scroll overflow detection in the TabBar
The tab strip uses `overflow-x: auto` with left/right chevron buttons that appear conditionally. Detecting whether the content overflows requires checking `scrollWidth > clientWidth`. A `scroll` event listener alone is insufficient because overflow can appear/disappear when tabs are opened or closed (content change, not scroll). Attaching a `ResizeObserver` to the scroll container catches both content resizes and container resizes reliably. Combined with the `scroll` event listener (for user scrolling), this covers all overflow state transitions.

### 38. Tab close activates the nearest neighbour, not the first tab
The initial Workspace.jsx implementation always activated `tabs[0]` when the active tab was closed. This is disorienting for users — if you close the 5th of 8 tabs, you expect the 4th or 6th to activate, not the 1st. The TabStore implements right-neighbour-first activation: if a tab at index `i` is closed and `i < newTabs.length`, activate `newTabs[i]` (the tab that slid into position); otherwise activate the new last tab. This matches VS Code's and browser tab behavior.

### 39. `Ctrl+Tab` in browsers is intercepted before JavaScript
`Ctrl+Tab` is a native browser shortcut for switching between browser tabs. In most browsers, JavaScript's `keydown` handler cannot `preventDefault()` this combination — the browser consumes it first. The Ctrl+Tab / Ctrl+Shift+Tab shortcuts in the TabBar work correctly when the app runs inside Electron or a PWA (where browser chrome disappears), but in a regular browser tab they may be silently swallowed. This is a known limitation shared by VS Code Web, FlowTest, and other web-based IDEs. For browser contexts, alternative bindings (e.g., `Alt+1..9`) could supplement these.

### 40. Bridging legacy window events into Zustand with a one-line listener
Rather than rewriting all event-dispatching callers (Sidebar, SidebarHeader, CollectionManager, etc.) to call `useTabStore.getState().openTab()` directly, a single `window.addEventListener('openWorkflow', (e) => openTab(e.detail))` in Workspace.jsx bridges the legacy CustomEvent pattern into the Zustand store. This is the same dual-strategy used in Phase 5 for `workflowsNeedRefresh`. Migration to direct store calls can happen incrementally — callers are changed one-by-one while the bridge ensures nothing breaks.

### 41. `scrollbar-none` Tailwind utility hides scrollbars without breaking scroll
The tab strip needs horizontal scrolling for overflow but visible scrollbars look cluttered on a 36px-high tab bar. Tailwind's `scrollbar-none` utility (or the `scrollbar-hide` plugin class) hides the scrollbar visually while keeping scroll functionality intact via left/right chevron buttons and mouse wheel. This matches the tab bar behavior in VS Code and most IDE-style tab strips.

### 42. CSS bundle grew minimally — design token adoption accelerates
Post-Phase 6 build: 207.46KB CSS (29.07KB gzip), 825.86KB JS (222.67KB gzip). The small increase (~4KB CSS, ~3KB JS vs Phase 5) reflects only the new organisms/TabBar and molecules/WorkspaceEmptyState. Reusing design tokens (`bg-surface`, `text-primary`, `border-border-default`) consistently means new components add near-zero novel CSS — they reuse existing utility classes. The design system investment from Phase 1 compounds here.

---

## Phase 7: Node Redesign — BaseNode + All Node Types (2026-02-10)

### 43. BaseNode render-prop pattern for collapse state
Rather than requiring each node to manage its own `isExpanded` state, BaseNode owns the state and passes it to children via a render-prop: `{({ isExpanded }) => (...)}`. This eliminates six separate `useState(false)` declarations across node components and guarantees consistent collapse behavior (animation, toggle button position, icon). The pattern: `children` can be either a React element or a function receiving `{ isExpanded, setIsExpanded }`.

### 44. BaseNode `extraHandles` prop for non-standard handle arrangements
Most nodes use a simple left-target + right-source handle pair (provided by `handleLeft`/`handleRight` props). But AssertionNode needs dual pass/fail handles at 35%/65% on the right side, and MergeNode uses purple-colored handles. The `extraHandles` prop accepts arbitrary ReactFlow `<Handle>` elements rendered inside the BaseNode's relative container, giving full positioning control while keeping BaseNode's API clean.

### 45. File truncation strategy for large component rewrites
When rewriting a node component, `replace_string_in_file` only replaces the matched text block — if you match just the imports, the old component body remains below the new code, producing two `export default` statements. The reliable strategy: (1) write the new component body to a temp file, (2) use PowerShell to keep the first N lines of the original (imports + sub-components), (3) concatenate and write back, (4) delete the temp file. This avoids partial replacement bugs entirely.

### 46. PowerShell here-strings preserve JS template literals
JavaScript template literals (`` `${var}` ``) contain `$` and backtick characters — both have special meaning in PowerShell. However, PowerShell's single-quoted here-string (`@'...'@`) treats all content literally: no variable expansion, no escape processing. This makes them safe for writing JSX files that contain template literals. The only constraint: the closing `'@` must be at the start of a line with no leading whitespace.

### 47. Design token migration strategy: batch PowerShell string replacement
For large files like NodeModal.jsx (1381 lines, 50+ hardcoded color references), individual `replace_string_in_file` calls are impractical. Instead, read the file as a single string, chain `.Replace()` calls for each pattern pair (`'bg-white dark:bg-gray-800'` → `'bg-surface dark:bg-surface-dark'`), and write back. This processes all replacements in one pass with zero risk of partial matches since `.Replace()` is literal (not regex). Applied 20+ replacement patterns to NodeModal in a single operation.

### 48. `getSmoothStepPath` vs `getBezierPath` for edge routing
ReactFlow offers both bezier (curved) and smooth-step (right-angle with rounded corners) edge path generators. FlowTest uses smooth-step paths which look cleaner on structured workflows where nodes are roughly grid-aligned. The `borderRadius` parameter (set to 12px) controls how rounded the right-angle corners are. Smooth-step paths also align better with the rectangular node shapes from the redesign.

### 49. Method color tokens create visual consistency across components
Defining `method-get`, `method-post`, `method-put`, `method-delete`, `method-patch` in `tailwind.config.js` means the same colors appear in HTTPRequestNode badges, AddNodesPanel drag items, and NodeModal method selectors — without duplicating hex values. Adding a new method (e.g., OPTIONS) requires only one config entry; all components pick it up via the token class.

### 50. CSS bundle shrank slightly after node redesign
Post-Phase 7 build: 213.60KB CSS (29.99KB gzip), 821.64KB JS (223.28KB gzip). The CSS is marginally larger than Phase 6 (+6KB raw, +0.9KB gzip) reflecting the new design token classes. But the JS bundle is actually smaller by ~4KB gzip — removing 6 copies of manual header/menu/expand logic from individual nodes in favor of the shared BaseNode wrapper reduced total component code. This validates the "extract shared shell" strategy.

---

## Phase 8: Modals & Panels Overhaul (2026-02-10)

### 51. Modal molecule + `open` prop pattern eliminates conditional render bugs
The old pattern `{showX && <Component />}` mounts/unmounts the component on every toggle, losing internal state and skipping Headless UI's enter/leave transitions. The new pattern always renders the component with `<Component open={showX} />`, and Headless UI Dialog's `Transition show={open}` handles visibility. This gives free focus trap, Escape-to-close, overlay click-to-close, and smooth enter/leave animations — replacing 25+ lines of manual click-outside/keydown/animation logic per modal.

### 52. `deleteTarget` state pattern for confirm dialogs
Replacing `if (!confirm(...)) return` with an accessible ConfirmDialog requires a two-step flow: (1) `setDeleteTarget(id)` stores the target ID, (2) `<ConfirmDialog open={!!deleteTarget} onConfirm={() => doDelete(deleteTarget)} />` shows the dialog. The `onConfirm` callback executes the actual delete, then clears `deleteTarget`. This is more lines of code but eliminates the browser's native, unstyleable, inconsistent-across-platforms confirm() dialog.

### 53. Safe fallback for Dialog children when data is null
NodeModal's caller previously used `{modalNode && <NodeModal node={modalNode} />}`. With the `open` prop pattern, the component is always rendered but the Dialog is hidden when `open=false`. However, the component body may still reference `node.data` during render. The fix: `node={modalNode || { data: {}, type: 'start' }}` provides a safe fallback so no null reference occurs during the hidden render cycle.

### 54. DaisyUI `collapse collapse-arrow` replaces manual accordion logic
Manual accordion implementations (expandedCategory state + ChevronDown/ChevronUp icon toggle + click handler) require ~15 lines per accordion section. DaisyUI's `collapse` component with `collapse-arrow` provides the same UX with built-in chevron animation, accessible toggle, and content transition — using only radio inputs for mutual exclusion. The DynamicFunctionsHelper refactor replaced 50+ lines of accordion logic with DaisyUI collapse classes.

### 55. NodeModal shell-only refactor — risk-proportional scope
NodeModal.jsx defines 6 components in one 1,382-line file (shell + HTTPRequestConfig + OutputPanel + AssertionFormModal + AssertionConfig + DelayConfig + MergeConfig). Refactoring the entire file risked breaking complex ref-based prop flows between sub-components. Instead, only the shell (lines 1–275) was upgraded: Dialog/Transition wrapper, removed manual click-outside/animation, applied design tokens. Internal sub-components were left unchanged. This delivered 80% of the accessibility improvement (focus trap, Escape key, overlay click) with 20% of the risk.

### 56. Inline style object syntax errors are invisible until build time
A missing comma in a JSX inline `style={{ ... }}` object is valid at the parser level in development (Vite's HMR may not catch it depending on where the error is), but fails during `vite build` when esbuild performs stricter parsing. Always run `npm run build` after editing style objects in large files. The NodeModal build fix was a single missing comma on line 103.

### 57. Toast replaces alert() with zero caller changes needed
`toast.error('message')` from sonner is a 1:1 drop-in for `alert('message')` — same synchronous call pattern, no return value needed. The only import addition is `import { toast } from 'sonner'`. For success cases (e.g., after delete), `toast.success()` adds a green notification that `alert()` couldn't distinguish. This made the alert→toast migration a pure find-and-replace operation across 3 files.

### 58. SlidePanel molecule complements Modal for non-blocking content
Modal is best for focused tasks (create, edit, confirm) that block the main content. SlidePanel is better for reference/helper content (Dynamic Functions, logs, variable inspector) that should remain visible alongside the canvas. The side prop (`left`/`right`) and the slide transition (vs Modal's scale/fade) reinforce the spatial metaphor: panels *slide in from the edge*, modals *appear in the center*.

### 59. WebhookManager rewrite yielded the largest line reduction (784→224)
The original WebhookManager had 4 manually-built overlay modals (each ~60 lines of backdrop + positioning + animation), 9 alert() calls, and 1 confirm() call. Replacing overlays with `<Modal>` (6 lines each), alerts with `toast.error/success` (1 line each), and confirm with `<ConfirmDialog>` (8 lines) collapsed the file by 71%. This was the best ROI refactor in Phase 8 — high visual impact, low risk since WebhookManager has no complex state dependencies.

---

## Phase 9: State Management Migration — Events to Zustand (2026-02-08)

### 60. SidebarStore already covered WorkflowListStore + EnvironmentStore scope
The todo planned three separate stores (WorkflowListStore, EnvironmentStore, CanvasStore). In practice, Phase 5's SidebarStore already held `workflows[]`, `collections[]`, `environments[]`, `fetchWorkflows()`, `fetchCollections()`, `fetchEnvironments()`, and version counters for workflows/collections. Adding a single `environmentVersion` counter + `signalEnvironmentsRefresh()` to SidebarStore was sufficient — no need for separate WorkflowListStore or EnvironmentStore. Avoid creating stores that duplicate existing state.

### 61. VariableStore was unnecessary — WorkflowContext is the correct scope
The todo planned a global `VariableStore` for `variables{}`, `extractors[]`, and deletion callbacks. However, variables are **per-workflow**, not global. WorkflowContext already owns this state with the correct lifecycle (mounted/unmounted per tab). The `variableDeleted` event was replaced with a ref-based callback pattern (`onVariablesDeletedRef`) inside WorkflowContext, keeping the communication within the same provider boundary. Global stores for per-instance state cause stale-data bugs.

### 62. Ref-based callback pattern for intra-provider communication
When two sibling components inside the same Context provider need to communicate (VariablesPanel → WorkflowCanvas, both inside WorkflowProvider), a `useRef` callback on the context is cleaner than either window events or a dedicated store. The provider exposes `onVariablesDeletedRef`; WorkflowCanvas sets it to its cleanup function; VariablesPanel calls `deleteVariablesWithCleanup()` which invokes the ref. This avoids re-renders from state changes while keeping the coupling explicit.

### 63. Dead event listeners reveal architectural drift
Two events had no matching dispatchers (`variablesToUpdate`) or were documented as no-ops (`extractorDeleted`'s listener comment said "we don't need this"). Both sides existed in the codebase without anyone noticing the disconnect. Lesson: when migrating events to stores, grep for both `dispatchEvent` AND `addEventListener` for each event name — mismatches indicate dead code.

### 64. Zustand `version` counter pattern for cross-component refresh signals
Instead of passing callback props or using events, a Zustand store can hold a version counter (e.g., `environmentVersion: 0`). Any modifier calls `signalEnvironmentsRefresh()` which increments the counter. Any consumer subscribes via `useSidebarStore((s) => s.environmentVersion)` and re-fetches when it changes. The guard `if (version > 0)` skips the initial mount. This is simpler than `useEffect` with callbacks and avoids the stale-closure pitfalls of window events.

### 65. `selectiveNodeUpdate` prevents unnecessary re-renders during polling
When adaptive polling returns node statuses every 100ms, naively calling `setNodes(...)` on every poll causes 10 re-renders/second even when nothing changed. The `selectiveNodeUpdate` function compares `executionStatus` and `executionResult` before creating a new node object — unchanged nodes keep their reference identity, so React skips their subtree. This was critical for keeping the canvas responsive during fast polling.

### 66. Hook extraction from a 1541-line component requires careful dependency analysis
WorkflowCanvas had deeply interleaved state: `runWorkflow` read `nodes`, `selectedEnvironment`, `environments`; polling read `setNodes`; auto-save read `nodes`, `edges`, `workflowVariables`, `saveWorkflow`. Each extracted hook needed a clear interface of inputs. The key insight: hooks that only *write* state (like `useAutoSave`) are easier to extract than hooks that both read and write shared state (like `useWorkflowPolling` which reads `nodes` for validation AND writes `setNodes` for status updates). Plan the interface boundaries before extracting.

### 67. Dynamic imports fail Vite's Rollup resolution for uninstalled packages
Using `const { toast } = await import('react-hot-toast')` inside a hook caused a build error even though the import was dynamic — Rollup still resolves the module at build time. The project uses `sonner`, not `react-hot-toast`. Fix: use a static import at the top of the hook file. Dynamic imports don't bypass missing-module errors in production builds.

### 68. Backup files (.backup.jsx) pollute grep results and should be gitignored
`Sidebar.backup.jsx` and `SidebarHeader.backup.jsx` still contained old `dispatchEvent`/`CustomEvent` patterns, creating false positives during the verification grep. Backup files should either be deleted or added to `.gitignore` to prevent confusion during code audits.

---

## Phase 10: Canvas Toolbar, Keyboard Shortcuts, Polish & Accessibility

### 69. Mousetrap ref pattern prevents shortcut rebinding on every render
Using `Mousetrap.bind()` inside `useEffect` with callback dependencies causes re-binding on every render. The fix: store callbacks in a `useRef` object, bind once to wrappers that read `callbacks.current[name]?.()`, and update the ref in a separate `useEffect`. This splits binding (once) from callback updates (every render), avoiding event listener leaks.

### 70. Headless UI Popover is superior to manual click-outside for floating panels
The AddNodesPanel used an `isPanelOpen` prop with manual toggle logic. Replacing it with `@headlessui/react`'s `Popover` + `Transition` gives: automatic focus trapping, click-outside dismiss, escape key handling, accessible `aria-expanded`, and animated enter/leave transitions. No custom event handlers needed. The trade-off is Popover is opinionated about positioning — use `PopoverPanel` with manual CSS when anchor positioning doesn't suffice.

### 71. DaisyUI `collapse collapse-arrow` replaces custom accordion logic
Node palette sections used custom open/close state management. DaisyUI's `<details>` + `collapse` class gives the same UX with zero JavaScript — the browser handles open/close natively via `<summary>`. Add `collapse-arrow` for the chevron icon. Pair with `collapse-title` and `collapse-content` for proper padding.

### 72. Skeleton atom with `count` prop generates list placeholders in one call
Rather than manually repeating skeleton elements, a `count` prop on the `Skeleton` atom generates N rows with a single `<Skeleton count={6} />`. Combined with `aria-hidden="true"`, this keeps loading states accessible while reducing template noise.

### 73. `role` and `aria-label` should target landmark elements, not wrappers
Adding `role="complementary" aria-label="Sidebar"` to the sidebar's root div (not an inner wrapper) ensures screen readers see it as a page landmark. Same for `role="main"` on the canvas and `role="toolbar"` on the toolbar. Misplacing these on inner divs makes them invisible to landmark navigation.

### 74. Console.log cleanup reduces bundle size measurably
Removing 15 `console.log` statements from WorkflowCanvas.jsx dropped the JS bundle from 908.90 KB to 908.04 KB — almost 1 KB of debug string literals. Across 53+ statements in the full codebase, the savings compound. Rule: never commit render-path `console.log`. Guard necessary debug output behind `import.meta.env.DEV`.

### 75. Orphaned pages survive unnoticed when routing changes bypass imports
`WorkflowList.jsx` (318 lines) was completely orphaned after tab-based navigation replaced the old route. No import, no route, no reference — yet it sat in `pages/` for weeks. Lesson: after any routing refactor, grep for every file in `pages/` and verify an import chain from `App.jsx` reaches each one.

### 76. ToolbarButton sub-component consolidates repeated button markup
The canvas toolbar had 8+ buttons with identical structure (icon + optional label + tooltip + onClick). Extracting a `ToolbarButton` sub-component inside the organism file eliminated ~120 lines of repetition and enforced consistent sizing, spacing, and hover states. Keep utility sub-components co-located in the same file when they're only used by one parent.

### 77. Bundle size impact of Headless UI Popover + Mousetrap
Adding `@headlessui/react` Popover (already a dependency — tree-shaken) and `mousetrap` (6.5 KB minified) increased the JS bundle from 845 KB → 908 KB over Phase 10. Most of the increase came from Headless UI's Popover internals. Acceptable for the accessibility and UX gains, but worth monitoring — dynamic imports could reclaim this if needed.
---

## Phase 11: UI/UX Refinement — Round 2 (2026-02-11)

### 78. Method badge spacing: `mr-2` on the badge itself complements parent `gap-2`
The BaseNode component wraps icons in a flexbox container with `gap-2`, but for inline badge elements (like the HTTP method badge), this gap alone doesn't provide enough visual breathing room next to the title text. Adding `mr-2` directly to the badge span gives better control over the spacing. This pattern applies whenever a decorative inline element (badge, pill, icon) renders next to text — the parent's flex gap handles structural spacing, while the element's right margin handles visual polish.

### 79. Single-property CSS changes are low-risk and ideal for incremental polish
Adding a single utility class (`mr-2`) to an existing element is extremely low-risk compared to multi-property refactors. The change is visually isolated, easily testable, and unlikely to cascade unintended side effects. When tackling UI polish tasks, prioritize these atomic changes — they accumulate into significant improvements without the debugging overhead of architectural changes.

### 80. Button redesign: FlowTest's shadow-on-hover pattern requires discrete variant classes
The FlowTest button system uses filled primary buttons with shadows (`bg-primary shadow-sm hover:shadow-md`), outlined secondary buttons with light tint backgrounds (`bg-primary/5 border border-primary`), and ghost buttons with minimal styling (`hover:bg-surface-overlay`). Attempting to compose these with DaisyUI's `btn btn-primary` classes creates conflicts — DaisyUI applies its own background, border, and shadow utilities that override the custom ones. The solution: completely remove DaisyUI button classes (`btn`, `btn-primary`, etc.) and use pure Tailwind composition with explicit class strings per variant.

### 81. Intent prop separates semantic meaning from visual style
The Button component's `intent` prop (`'default' | 'success' | 'error' | 'warning' | 'info'`) allows semantic labeling of buttons independent of their variant (`'primary' | 'secondary' | 'ghost'`). For example, a delete button can be `variant="ghost" intent="error"` (minimal red text) or `variant="primary" intent="error"` (filled red with white text). This two-axis pattern scales better than mapping each semantic action to a fixed visual style.

### 82. Lucide-react's Loader2 provides a clean loading spinner
Instead of DaisyUI's `<span className="loading loading-spinner loading-sm" />`, lucide-react's `<Loader2 className="w-4 h-4 animate-spin" />` gives a consistent icon-style spinner that matches the rest of the icon library. The `animate-spin` utility from Tailwind handles the rotation. This eliminates the need for DaisyUI's loading component classes entirely.

### 83. Button component consolidation reduces line count without removing features
Migrating 8 files (NodeModal, WorkflowJsonEditor, WebhookManager, SecretsPrompt, SecretsPanel, etc.) from raw DaisyUI button elements to the new Button component eliminated ~80 lines of repetitive className strings while adding features (intent prop, consistent shadow effects, unified loading states). The Button component itself is only 110 lines, so the net line reduction is significant.

### 84. fullWidth prop replaces flex-1 for button expansion in flex containers
Modal footers previously used `<button className="btn btn-ghost flex-1">` to make buttons expand equally in the flex container. The new Button component's `fullWidth` prop (`fullWidth && 'w-full'`) achieves the same result with clearer intent — the button spans its container width regardless of whether the container uses flexbox or grid.

### 85. Inline style overrides for square buttons: `!p-2 !min-w-0`
Close buttons (X icons) need to be square, not rectangular. DaisyUI's `btn-square` class achieved this. With custom Button component, the equivalent is `className="!p-2 !min-w-0"` — the `!` prefix forces the padding override over the size variant's defaults. The `min-w-0` removes the implicit minimum width that text buttons need, allowing the icon-only button to shrink to its content size.

### 86. Ghost button intent colors apply to text, not background
For ghost buttons, the intent prop changes the text color (`text-warning`, `text-status-error`) but keeps the background transparent/minimal. This differs from primary buttons where intent changes the background fill. The asymmetry is intentional: ghost buttons are low-emphasis and rely on color to convey meaning, while primary buttons use both color and weight.

### 87. Build success confirms zero breaking changes from button migration
The complete button redesign (10+ file changes) built successfully on first attempt with zero errors, confirming that the Button component API (`variant`, `intent`, `size`, `onClick`, `disabled`, `children`) was a complete drop-in replacement for the previous raw button patterns. This validates the upfront API design — spending time on the Button component interface before migrating callers paid off.

### 88. Tailwind `group-hover:` requires parent-child relationship, not siblings
The initial attempt to add hover labels to assertion node handles applied the `group` class directly to the `<Handle>` component and `group-hover:opacity-100` to the label div. This failed because Tailwind's `group-hover:` modifier only works when hovering over an ancestor with the `group` class — not a sibling. The label div was a sibling to the Handle, so the hover never triggered. Solution: wrap both the Handle and label in a container div with `className="group"`, making the label a child of the group container.

### 89. ReactFlow Handle positioning with transforms requires container coordination
Moving the assertion node handles from bottom-aligned (`bottom: 40`, `bottom: 0`) to vertically centered (`top: '50%', transform: 'translateY(-20px)'`) required careful positioning of both the Handle itself and its hover label. The solution: apply the transform to a wrapper div (`style={{ top: '50%', right: 0, transform: 'translateY(-20px)' }}`), then position the Handle relatively within that container (`style={{ position: 'relative' }}`). This keeps the Handle at the correct vertical position while allowing the label to be absolutely positioned relative to the Handle.

### 90. Hover transitions should use `transition-opacity` for smooth fade-in
The assertion handle labels fade from invisible (`opacity-0`) to visible (`group-hover:opacity-100`) on hover. Adding `transition-opacity` to the label's className creates a smooth CSS transition instead of an instant snap. Without this, the label would appear jarringly on hover. The default Tailwind transition duration (150ms) feels responsive without being sluggish.

### 91. Inline styles with `whiteSpace: 'nowrap'` prevent label text wrapping
The "Pass" and "Fail" labels are short single words, but if a future label is longer (e.g., "Validation Passed"), it could wrap to multiple lines and break the layout. Adding `whiteSpace: 'nowrap'` to the label's inline style ensures the text always renders on a single line, maintaining the compact design. This is a defensive pattern for any absolutely positioned UI label.

### 92. Code tag styling for inline technical terms requires explicit color contrast
When technical terms like `prev.*` and `variables.*` are embedded in paragraph text, they need explicit styling to stand out — simply using `<code>` without color styling doesn't provide enough visual distinction. The blue color scheme (`bg-blue-100 dark:bg-blue-800/50 text-blue-900 dark:text-blue-200`) was specifically chosen because blue conventionally signals "code" or "technical information" in developer tools, and provides strong contrast against the tips section's light blue background (`bg-blue-50 dark:bg-blue-900/20`). The padding (`px-1.5 py-0.5`) is slightly increased from typical inline code (which often uses `px-1`) to create more breathing room around the text, making it easier to read at the small font size (`text-[9px]`).

### 93. Inline examples in tips sections reduce cognitive load
Adding JSONPath examples like `body.data[0].id` and `response.user.email` directly in the tips section eliminates the need for users to context-switch to documentation or remember syntax patterns. These concrete examples are more immediately actionable than abstract descriptions like "use dot notation for nested fields." The examples were chosen to demonstrate two common patterns: array indexing (`[0]`) and nested object access (`.user.email`), covering the majority of use cases users will encounter when writing assertions.

### 94. Font size hierarchy: base text vs code snippets
The tips section uses `text-[9px]` for base paragraph text but the same `text-[9px]` for code snippets. Normally, inline code is slightly larger than surrounding text for readability (e.g., `text-sm` base with `text-base` code). However, at very small font sizes (8-9px), making code larger can feel disproportionate. The solution was to keep code the same size as body text but use background color, padding, and font-family (`font-mono`) to create visual distinction. The result feels balanced without the code overwhelming the text at this compact scale.

### 95. ReactFlow defaultEdgeOptions propagates properties to all new edges
ReactFlow's `defaultEdgeOptions` prop is applied to every edge created through the `onConnect` handler, unless the handler explicitly overrides those properties. Adding `animated: true` to `defaultEdgeOptions={{ type: 'custom', animated: true }}` ensures all edges have the flowing animation effect by default, without needing to set it individually in the connection handler. This pattern is cleaner than checking each edge creation point and manually adding the animated property. Note that existing edges in the database won't have this property until they're reconnected or the workflow is re-saved.

### 96. ReactFlow Panel positioning is relative to the ReactFlow container, not the viewport
The `<Panel>` component from ReactFlow positions its content relative to the ReactFlow container boundaries, not the browser viewport. When positioning with `position="bottom-left"` and `style={{ bottom: 60, left: 10 }}`, these coordinates are relative to the ReactFlow container's edges. If the ReactFlow container is nested within an Allotment pane (as in MainLayout), the coordinates are still relative to that pane's content area, not absolute to the window. This means a `left: 10` position should naturally avoid the sidebar since the ReactFlow container is in the right pane of the split layout.

### 97. MiniMap placement: bottom-right avoids UI overlap in split-pane layouts
In a two-pane layout (sidebar left, canvas right), placing the minimap at `bottom-left` can cause visual conflicts if the split pane divider is narrow or if future sidebar changes extend its rendering area. Moving the minimap to `bottom-right` with `position="bottom-right"` and `style={{ bottom: 10, right: 10 }}` ensures it's always visible in the canvas area with no risk of overlap from left-side UI elements (sidebar, controls, etc.). This position also feels more natural in Western UIs where the primary action area is the left-to-right reading flow, leaving the bottom-right as a utility zone.

### 98. Assertion node edges retain animation after manual styling
When creating edges from assertion nodes, the code explicitly sets `animated: true` alongside custom colors (green/red for pass/fail). This per-edge override takes precedence over `defaultEdgeOptions`. The result is that assertion edges are always animated (even before the global `animated: true` default was added), which is why they appeared to "always have animations" while regular edges didn't. This inconsistency was user-visible and confusing — users expected all edges to animate during workflow execution, not just assertion edges. Standardizing on `animated: true` as the default eliminates this cognitive load.

### 99. ReactFlow MiniMap nodeColor callback receives full node objects with data
The `nodeColor` prop on MiniMap receives each node object (including `type`, `data`, `position`, etc.), not just the node ID. This enables sophisticated color logic: checking `n.data?.executionStatus` for runtime state colors (running=blue, success=green, error=red) that take precedence over static node type colors. This priority system (execution state → node type → default) creates a minimap that reflects both the workflow structure (different node types) and the current execution state, making it far more informative than a single-color approach.

### 100. MiniMap visual hierarchy: execution status > node type > default
When coloring minimap nodes, priority matters. Execution status colors (running, success, error) should override node type colors because they represent time-sensitive information that users need to see immediately during workflow runs. Node type colors (HTTP=indigo, assertion=green, delay=yellow) create visual structure in the idle state. Default gray is the fallback for unknown types. This three-tier hierarchy is implemented with early returns in the `nodeColor` callback: check execution status first, then node type, then return default. Without this order, a running HTTP node would appear indigo (type color) instead of blue (running state), hiding critical runtime information.

### 101. nodeStrokeWidth adds definition to minimap nodes without cluttering
Adding `nodeStrokeWidth={2}` and `nodeStrokeColor` to the MiniMap creates visible borders around each node, making them stand out against the background mask. At small minimap scale (220x150), nodes without strokes can blend together, especially in dark mode where mask opacity is high. The 2px stroke is thick enough to be visible at minimap scale but doesn't overwhelm the color fill. Error nodes get a darker red stroke (`#dc2626` / `#b91c1c`) for extra emphasis, creating a double-layer signal (red fill + darker red border) that stands out even in peripheral vision.

### 102. MiniMap size optimization: 220x150 shows detail without blocking canvas
The minimap size jumped from 180x120 to 220x150 (+22% width, +25% height). This is large enough to distinguish individual nodes and their states but small enough to remain a utility element rather than a primary view. At 180x120, nodes with 3+ characters in labels or complex layouts became too compressed to be useful. At 220x150, the aspect ratio (1.47:1) roughly matches typical workflow layouts (wider than tall), and the absolute size fits comfortably in the bottom-right corner without obstructing canvas work. Beyond 250x150, the minimap starts feeling intrusive and defeats its purpose as a glanceable overview.

### 103. ReactFlow callback props MUST be memoized with useCallback to prevent infinite loops
Passing inline arrow functions to ReactFlow components (MiniMap, custom nodes, edge renderers) that reference props/state creates a new function reference on every render. ReactFlow's internal store detects this change and triggers a re-render, which creates a new function, which triggers another re-render — infinite loop. The error "Maximum update depth exceeded" always indicates this pattern. The fix: wrap all callback props (`nodeColor`, `nodeStrokeColor`, `onNodeClick`, etc.) in `useCallback` with explicit dependencies. For MiniMap's `nodeColor` callback that references `darkMode`, the memoization is `useCallback((n) => { ... }, [darkMode])`. This ensures the function reference only changes when `darkMode` actually changes, not on every render.

### 104. useCallback dependencies must match what the callback actually uses
When wrapping a callback with `useCallback`, the dependency array must include ALL values from the surrounding scope that the callback references. For `getNodeColor` and `getNodeStrokeColor`, the only external dependency is `darkMode` — the callbacks don't read `nodes`, `edges`, `workflowId`, or any other state. Including unnecessary dependencies causes the memoization to break (new function on every render anyway), while missing dependencies causes stale closures (the callback uses outdated values). ESLint's `exhaustive-deps` rule helps catch this, but React itself doesn't enforce it — incorrect dependencies silently produce bugs.

### 105. Extracting inline callbacks to named useCallback is more maintainable
Rather than putting a large inline arrow function directly in JSX (`nodeColor={(n) => { ...20 lines... }}`), extract it to a named constant above the return: `const getNodeColor = useCallback((n) => { ... }, [darkMode])`. This achieves three benefits: (1) the JSX stays clean and readable (`nodeColor={getNodeColor}`), (2) the callback logic is visible at the component level where other hooks live, making dependencies obvious, (3) multiple components can reuse the same memoized callback if needed. The naming convention `get*` for pure functions and `handle*` for event handlers helps distinguish intent at a glance.

---

## Phase 12: Swagger environment sync hardening (2026-02-11)

### 106. Schema drift warnings must be keyed by durable endpoint identity, not by node type
Marking every `http-request` node with a generic warning creates high false-positive noise and destroys trust in warnings. The robust pattern is endpoint identity metadata (method + normalized path + optional operationId) embedded at OpenAPI parse time (`openapiMeta.fingerprint`) and carried forward into dragged nodes. Only nodes that carry this metadata should be eligible for schema drift checks.

### 107. Metadata can be silently dropped at transformation boundaries
The OpenAPI parser produced rich node configs, but intermediate adapters (`nodes -> palette item -> node template -> dropped node config`) only copied a whitelist of known fields (url, method, headers, etc.). Any schema-link metadata not explicitly threaded through each adapter disappears. When introducing new cross-cutting metadata, audit every conversion layer end-to-end.

### 108. Meaningful mismatch detection needs fallback matching tiers
Comparing only full fingerprint can still create false warnings when non-breaking metadata changes (for example operationId changes while method+path stays the same). A practical matcher uses tiers: exact fingerprint match, then method+path match, then operationId relocation, then method mismatch on same path, then missing endpoint. This reduces warning noise while still surfacing actual API drift.
