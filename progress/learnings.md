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
