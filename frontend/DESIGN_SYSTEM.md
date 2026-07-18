# APIWeave Design System

> **Established:** 2026-02-09 (Phase 1)
> **Updated:** 2026-05-16 (TypeScript Migration + UI Overhaul)
> **Component Library:** DaisyUI 5.x (Tailwind CSS plugin) + Custom Atoms/Molecules
> **Architecture:** Atomic Design (atoms → molecules → organisms → layout → pages)
> **Language:** TypeScript (strict mode)

---

## MANDATORY Rules

### TypeScript

- ALL files MUST be `.ts` or `.tsx` — no `.js` or `.jsx`
- `tsconfig.json` strict mode enabled — `any` is forbidden
- ALL props, state, hooks, stores, API calls MUST have explicit types
- Shared types live in `src/types/` — ONE type per file, NEVER duplicate type definitions
- **ONE type per file**: Every type, interface, or union MUST be in its own file named after the type (e.g., `Workflow.ts`, `ButtonProps.ts`). Barrel export `index.ts` re-exports all types.

### DRY — Never Duplicate

- **Buttons**: always use `Button` or `IconButton` atoms
- **Panels**: always use `Panel` molecule
- **Form Fields**: always use `FormField` molecule
- **Cards**: always use `Card` molecule
- **Tabs**: always use `PanelTabs` molecule
- **Empty States**: always use `EmptyState` molecule
- **Status Badges**: always use `StatusBadge` molecule
- If a pattern appears **2+ times**, extract it into a reusable component

---

## Color Tokens

### Brand / Primary

| Token           | Light                | Dark                 | Usage                          |
| --------------- | -------------------- | -------------------- | ------------------------------ |
| `primary`       | `#164e63` (cyan-900) | `#22d3ee` (cyan-400) | Primary actions, active states |
| `primary-light` | `#0e7490` (cyan-700) | `#06b6d4` (cyan-500) | Hover, secondary emphasis      |
| `primary-hover` | `#155e75` (cyan-800) | `#67e8f9` (cyan-300) | Hover state                    |
| `primary-dark`  | `#083344` (cyan-950) | —                    | Deep emphasis                  |

### Surfaces

| Token             | Light                 | Dark                 | Usage                 |
| ----------------- | --------------------- | -------------------- | --------------------- |
| `surface`         | `#f8fafc` (slate-50)  | `#111827` (gray-900) | Page background       |
| `surface-raised`  | `#ffffff`             | `#1f2937` (gray-800) | Cards, panels, modals |
| `surface-overlay` | `#f1f5f9` (slate-100) | `#1e293b` (gray-850) | Dropdowns, popovers   |

### Text

| Token            | Light                | Dark                 | Usage                |
| ---------------- | -------------------- | -------------------- | -------------------- |
| `text-primary`   | `#111827` (gray-900) | `#f3f4f6` (gray-100) | Body text, headings  |
| `text-secondary` | `#4b5563` (gray-600) | `#9ca3af` (gray-400) | Labels, descriptions |
| `text-muted`     | `#9ca3af` (gray-400) | `#4b5563` (gray-600) | Placeholders, hints  |

### Borders

| Token          | Light                 | Dark                 | Usage              |
| -------------- | --------------------- | -------------------- | ------------------ |
| `border`       | `#cbd5e1` (slate-300) | `#374151` (gray-700) | Default borders    |
| `border-focus` | `#164e63`             | `#22d3ee`            | Focus ring borders |

### Status

| Token            | Value                 | Usage                  |
| ---------------- | --------------------- | ---------------------- |
| `status-success` | `#16a34a` / `#4ade80` | Pass, success          |
| `status-error`   | `#dc2626` / `#f87171` | Fail, error            |
| `status-warning` | `#f59e0b` / `#fbbf24` | Warning, caution       |
| `status-running` | `#eab308` / `#facc15` | In-progress, executing |
| `status-info`    | `#2563eb` / `#3b82f6` | Informational          |

### HTTP Method Colors

| Method | Color  | Hex       |
| ------ | ------ | --------- |
| GET    | Green  | `#16a34a` |
| POST   | Blue   | `#2563eb` |
| PUT    | Orange | `#ea580c` |
| PATCH  | Violet | `#7c3aed` |
| DELETE | Red    | `#dc2626` |

---

## Typography

| Role        | Font Family    | Weights                 | Usage                              |
| ----------- | -------------- | ----------------------- | ---------------------------------- |
| **Body**    | Open Sans      | 300, 400, 500, 600, 700 | All body text, labels, inputs      |
| **Display** | Montserrat     | 500, 600, 700, 800      | Headings, logo, branding           |
| **Code**    | JetBrains Mono | 400, 500, 600           | Code blocks, JSON, URLs, monospace |

### Tailwind Classes

- Body text: `font-sans` (default)
- Headings: `font-display`
- Code: `font-mono`

---

## Spacing & Sizing

| Token             | Value | Usage                     |
| ----------------- | ----- | ------------------------- |
| `header-height`   | 48px  | Main header               |
| `footer-height`   | 32px  | Main footer               |
| `nav-collapsed`   | 56px  | AppNavBar collapsed width |
| `nav-expanded`    | 180px | AppNavBar expanded width  |
| `sidebar-default` | 380px | Default sidebar width     |
| `sidebar-max`     | 600px | Max sidebar width         |
| `node-compact`    | 200px | Compact node width        |
| `node-max`        | 320px | Max node width            |

---

## DaisyUI Themes

Two custom themes are defined in `tailwind.config.js`:

### `apiweave` (Light)

- Primary: cyan-900 (`#164e63`) — deep, professional
- Base: slate-50 → white surface hierarchy
- Text: gray-900 for max readability

### `apiweave-dark` (Dark)

- Primary: cyan-400 (`#22d3ee`) — vibrant on dark
- Base: gray-900 → gray-800 surface hierarchy
- Text: gray-100 for readability on dark backgrounds

### Theme Switching

The `App.tsx` component manages both:

1. Tailwind `dark:` class on `<html>` — for Tailwind utility dark variants
2. DaisyUI `data-theme` attribute — for DaisyUI component theming

```tsx
// In App.tsx useEffect
document.documentElement.classList.add("dark"); // Tailwind
document.documentElement.setAttribute("data-theme", "apiweave-dark"); // DaisyUI
```

---

## CSS Custom Properties

All design tokens are also available as CSS custom properties (defined in `src/styles/base.css`), prefixed with `--aw-`:

```css
var(--aw-surface)           /* Page background */
var(--aw-surface-raised)    /* Card/panel background */
var(--aw-text-primary)      /* Main text color */
var(--aw-border)            /* Default border color */
var(--aw-primary)           /* Brand primary */
var(--aw-status-success)    /* Success state */
var(--aw-transition-normal) /* 300ms ease-in-out */
var(--aw-shadow-node)       /* Node drop shadow */
var(--aw-radius-lg)         /* 0.5rem border radius */
```

These properties automatically switch values between light and dark themes.

---

## Shadows

| Token                  | Usage               |
| ---------------------- | ------------------- |
| `shadow-node`          | Default node shadow |
| `shadow-node-hover`    | Node hover state    |
| `shadow-node-selected` | Node selected ring  |

---

## Animations

| Token                    | Usage                               |
| ------------------------ | ----------------------------------- |
| `animate-pulse-border`   | Running/executing node border pulse |
| `--aw-transition-fast`   | 150ms — micro-interactions          |
| `--aw-transition-normal` | 300ms — standard transitions        |
| `--aw-transition-slow`   | 500ms — layout shifts               |

---

## Component Inventory

### Atoms

| Component    | File                   | Purpose                                                                                                                  |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Button`     | `atoms/Button.tsx`     | Primary/secondary/ghost button with variant × intent × size matrix. Supports `loading`, `icon`, `fullWidth`, `disabled`. |
| `IconButton` | `atoms/IconButton.tsx` | Icon-only button with optional Tippy tooltip. Supports `size`, `variant`, `disabled`, `loading`.                         |
| `Input`      | `atoms/Input.tsx`      | Text input with proper focus ring, error state, and dark mode support.                                                   |
| `TextArea`   | `atoms/TextArea.tsx`   | Multi-line text input with resize control and dark mode support.                                                         |
| `Badge`      | `atoms/Badge.tsx`      | Status/info badge with `variant` (ghost/primary/success/error/warning/info) and `size` (xs/sm/md).                       |
| `Toggle`     | `atoms/Toggle.tsx`     | Toggle switch with label support and dark mode.                                                                          |
| `Spinner`    | `atoms/Spinner.tsx`    | Loading spinner with `size` (xs/sm/md/lg) and optional `label`.                                                          |
| `Skeleton`   | `atoms/Skeleton.tsx`   | Loading placeholder with `variant` (text/circle/rect).                                                                   |
| `Divider`    | `atoms/Divider.tsx`    | Horizontal/vertical divider line.                                                                                        |
| `Tooltip`    | `atoms/Tooltip.tsx`    | Tippy-based tooltip wrapper.                                                                                             |

### Molecules

| Component             | File                                | Purpose                                                                                                                     |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Panel`               | `molecules/Panel.tsx`               | Reusable panel shell with `title`, `icon`, `collapsible`, `headerActions`, `children`, `footer`. Used by all panel layouts. |
| `PanelTabs`           | `molecules/PanelTabs.tsx`           | Reusable tab bar for panels. Props: `tabs: { key, icon, label }[]`, `activeTab`, `onTabChange`.                             |
| `FormField`           | `molecules/FormField.tsx`           | Reusable form field wrapper with `label`, `hint`, `error`, `required`, `children`. Wraps any input.                         |
| `Card`                | `molecules/Card.tsx`                | Reusable card with `title`, `icon`, `headerActions`, `collapsible`, `children`.                                             |
| `Modal`               | `molecules/Modal.tsx`               | Shared modal shell with Headless UI Dialog. Sizes: `sm`, `md`, `lg`, `xl`, `fullscreen`.                                    |
| `ConfirmDialog`       | `molecules/ConfirmDialog.tsx`       | Confirmation dialog with `title`, `message`, `confirmLabel`, `intent`.                                                      |
| `PromptDialog`        | `molecules/PromptDialog.tsx`        | Text input prompt dialog with `title`, `message`, `placeholder`, `submitLabel`.                                             |
| `EmptyState`          | `molecules/EmptyState.tsx`          | Reusable empty state with `icon`, `title`, `description`, `action`.                                                         |
| `WorkspaceEmptyState` | `molecules/WorkspaceEmptyState.tsx` | Workspace-level empty state with CTA to create workflow.                                                                    |
| `SearchInput`         | `molecules/SearchInput.tsx`         | Search input with icon and clear button.                                                                                    |
| `KeyValueEditor`      | `molecules/KeyValueEditor.tsx`      | Key-value pair editor for headers, query params, etc.                                                                       |
| `StatusBadge`         | `molecules/StatusBadge.tsx`         | Unified status indicator for runs, nodes, etc.                                                                              |
| `SlidePanel`          | `molecules/SlidePanel.tsx`          | Slide-in panel for side content.                                                                                            |

### Organisms

| Component               | File                                  | Purpose                                                                                |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `CanvasToolbar`         | `organisms/CanvasToolbar.tsx`         | Floating horizontal toolbar for the workflow canvas. Uses `Button`/`IconButton` atoms. |
| `TabBar`                | `organisms/TabBar.tsx`                | Workspace tab strip with scroll overflow, context menu, close buttons.                 |
| `KeyboardShortcutsHelp` | `organisms/KeyboardShortcutsHelp.tsx` | Modal displaying all keyboard shortcuts. Uses DaisyUI `kbd` elements.                  |

### Layout

| Component       | File                       | Purpose                                                    |
| --------------- | -------------------------- | ---------------------------------------------------------- |
| `MainLayout`    | `layout/MainLayout.tsx`    | Top-level layout with AppNavBar, Sidebar, Workspace.       |
| `AppNavBar`     | `layout/AppNavBar.tsx`     | Left icon navigation bar with collapse/expand.             |
| `Sidebar`       | `layout/Sidebar.tsx`       | Workflow/project list with search, pagination, actions. |
| `SidebarHeader` | `layout/SidebarHeader.tsx` | Sidebar header with breadcrumb, actions, search.           |
| `MainHeader`    | `layout/MainHeader.tsx`    | Top header bar with logo, environment, theme controls.     |
| `MainFooter`    | `layout/MainFooter.tsx`    | Bottom status bar.                                         |
| `Workspace`     | `layout/Workspace.tsx`     | Main workspace area with tabs, canvas, side panels.        |

### Nodes (ReactFlow)

| Component         | File                            | Purpose                                                        |
| ----------------- | ------------------------------- | -------------------------------------------------------------- |
| `BaseNode`        | `atoms/flow/BaseNode.tsx`       | Shared node shell for all ReactFlow nodes.                     |
| `NodeHandle`      | `atoms/flow/NodeHandle.tsx`     | Typed connection handle.                                       |
| `NodeActionMenu`  | `atoms/flow/NodeActionMenu.tsx` | Three-dot context menu for nodes.                              |
| `HTTPRequestNode` | `nodes/HTTPRequestNode.tsx`     | HTTP request node with method, URL, headers, body, extractors. |
| `AssertionNode`   | `nodes/AssertionNode.tsx`       | Assertion node for response validation.                        |
| `DelayNode`       | `nodes/DelayNode.tsx`           | Delay node for timing control.                                 |
| `MergeNode`       | `nodes/MergeNode.tsx`           | Merge node for parallel branch synchronization.                |
| `StartNode`       | `nodes/StartNode.tsx`           | Workflow start node.                                           |
| `EndNode`         | `nodes/EndNode.tsx`             | Workflow end node.                                             |

### Hooks

| Hook                   | File                            | Purpose                                          |
| ---------------------- | ------------------------------- | ------------------------------------------------ |
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.ts` | Global keyboard shortcut bindings via Mousetrap. |
| `useWorkflowPolling`   | `hooks/useWorkflowPolling.ts`   | Workflow run polling with adaptive intervals.    |
| `useCanvasDrop`        | `hooks/useCanvasDrop.ts`        | Canvas drag-and-drop handling.                   |
| `useAutoSave`          | `hooks/useAutoSave.ts`          | Auto-save behavior with debounce.                |

### Accessibility Enhancements

- `role="toolbar"` on `CanvasToolbar`
- `role="main" aria-label="Workflow canvas"` on `WorkflowCanvas`
- `role="complementary" aria-label="Sidebar"` on `Sidebar`
- `aria-label="Main navigation"` on `AppNavBar` nav element
- `aria-hidden="true"` on decorative `Skeleton` elements
- All interactive buttons have explicit `title` attributes
- Focus management in modals via Headless UI

### Phase 10 Verification Baseline

- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm test` pass as of 2026-05-16.
- `frontend/src` contains only TypeScript source and test files (`.ts`/`.tsx`); legacy `.js` tests were migrated to `.ts`.
- Production `console.log`/`console.info` statements are not allowed in `frontend/src`; use `console.warn`/`console.error` only for actionable diagnostics.
- Light/dark mode coverage is enforced through tokenized Tailwind classes and `dark:` variants, with page landmarks verified for keyboard and screen-reader navigation.
- Responsive behavior relies on the split-pane layout (`Allotment`), flexible panel widths, and overflow-safe canvas/workspace containers rather than fixed viewport assumptions.

---

## File Structure

```
frontend/
├── tsconfig.json              — TypeScript strict mode configuration
├── tailwind.config.js         — Design tokens, DaisyUI config, custom themes
├── vite.config.ts             — Vite build configuration
├── index.html                 — Google Fonts import
├── src/
│   ├── types/
│   │   ├── index.ts           — Barrel export (re-exports all types)
│   │   ├── Workflow.ts        — Workflow interface
│   │   ├── WorkflowNode.ts    — WorkflowNode interface
│   │   ├── ButtonVariant.ts   — ButtonVariant union type
│   │   ├── ButtonProps.ts     — ButtonProps interface
│   │   └── ...                — One file per type/interface
│   ├── index.css              — Tailwind directives + ReactFlow dark mode overrides
│   ├── main.tsx               — App entry point
│   ├── App.tsx                — Root component with theme switching
│   ├── styles/
│   │   └── base.css           — CSS custom properties, global resets, scrollbar styling
│   └── components/
│       ├── atoms/
│       │   ├── Button.tsx         — Primary/secondary/ghost button
│       │   ├── IconButton.tsx     — Icon-only button
│       │   ├── Input.tsx          — Text input
│       │   ├── TextArea.tsx       — Multi-line input
│       │   ├── Badge.tsx          — Status badge
│       │   ├── Toggle.tsx         — Toggle switch
│       │   ├── Spinner.tsx        — Loading spinner
│       │   ├── Skeleton.tsx       — Loading placeholder
│       │   ├── Divider.tsx        — Divider line
│       │   ├── Tooltip.tsx        — Tooltip wrapper
│       │   ├── flow/
│       │   │   ├── BaseNode.tsx       — Shared node shell
│       │   │   ├── NodeHandle.tsx     — Connection handle
│       │   │   └── NodeActionMenu.tsx — Node context menu
│       │   └── index.ts           — Barrel exports
│       ├── molecules/
│       │   ├── Panel.tsx          — Reusable panel shell
│       │   ├── PanelTabs.tsx      — Reusable tab bar
│       │   ├── FormField.tsx      — Reusable form field
│       │   ├── Card.tsx           — Reusable card
│       │   ├── Modal.tsx          — Modal shell
│       │   ├── ConfirmDialog.tsx  — Confirmation dialog
│       │   ├── PromptDialog.tsx   — Text prompt dialog
│       │   ├── EmptyState.tsx     — Empty state
│       │   ├── SearchInput.tsx    — Search input
│       │   ├── KeyValueEditor.tsx — Key-value editor
│       │   ├── StatusBadge.tsx    — Status indicator
│       │   ├── SlidePanel.tsx     — Slide-in panel
│       │   └── index.ts           — Barrel exports
│       ├── organisms/
│       │   ├── CanvasToolbar.tsx        — Canvas floating toolbar
│       │   ├── TabBar.tsx               — Workspace tab strip
│       │   ├── KeyboardShortcutsHelp.tsx — Shortcut help modal
│       │   └── index.ts                 — Barrel exports
│       ├── layout/
│       │   ├── MainLayout.tsx     — Top-level layout
│       │   ├── AppNavBar.tsx      — Left icon navigation
│       │   ├── Sidebar.tsx        — Workflow/project list
│       │   ├── SidebarHeader.tsx  — Sidebar header
│       │   ├── MainHeader.tsx     — Top header bar
│       │   ├── MainFooter.tsx     — Bottom status bar
│       │   └── Workspace.tsx      — Main workspace area
│       └── nodes/
│           ├── HTTPRequestNode.tsx — HTTP request node
│           ├── AssertionNode.tsx   — Assertion node
│           ├── DelayNode.tsx       — Delay node
│           ├── MergeNode.tsx       — Merge node
│           ├── StartNode.tsx       — Start node
│           └── EndNode.tsx         — End node
```

---

## Full Redesign Contract

> **Status:** Design contract for upcoming token migration.  
> **Scope:** Defines intent, rules, and constraints for the redesign. Does NOT yet change code tokens — those remain as documented above until Task 4.  
> **Date:** 2026-06-04

This contract is the single source of truth for all redesign decisions. Any deviation requires explicit amendment.

---

### 1. Palette Intent

- **Balanced light/dark mode** — both themes are first-class citizens. The app is NOT dark-only or OLED-only. Light mode is the default; dark mode is an equally polished alternative.
- **Warm neutral surfaces** — replace cool slate/gray neutrals with warmer, more inviting tones that reduce eye strain in long sessions.
- **Cyan/teal primary** — retain the current cyan-900 (light) / cyan-400 (dark) primary hue but refine saturation and lightness for better accessibility.
- **Semantic status colors** — success, error, warning, running, and info must be distinguishable by users with color-vision deficiencies (never rely on hue alone).

**Token mapping decisions (pending implementation):**

- `surface` family will shift from slate-50/white/slate-100 to a warmer neutral scale.
- `text-primary` will maintain ~4.5:1 minimum contrast against `surface` in both themes.
- `border` will use mid-tone values that are visible in both light and dark without being visually heavy.

---

### 2. Typography

- **Plus Jakarta Sans** — the new default font family for all UI and display text (body, headings, labels, buttons, inputs). Replaces Open Sans (body) and Montserrat (display).
- **JetBrains Mono** — the dedicated monospace font for code blocks, JSON, URLs, and any monospace context. Retained from current system.
- **Size scale:**
  - `xs`: 0.75rem (12px)
  - `sm`: 0.875rem (14px)
  - `base`: 1rem (16px)
  - `lg`: 1.125rem (18px)
  - `xl`: 1.25rem (20px)
  - `2xl`: 1.5rem (24px)
  - `3xl`: 1.875rem (30px)
  - `4xl`: 2.25rem (36px)
- **Weight scale:**
  - `regular`: 400
  - `medium`: 500
  - `semibold`: 600
  - `bold`: 700
- **Line-height scale:**
  - `tight`: 1.25 (headings, badges)
  - `normal`: 1.5 (body text)
  - `relaxed`: 1.625 (long-form, descriptions)

**Tailwind mapping (pending):**

- `font-sans` → Plus Jakarta Sans
- `font-display` → Plus Jakarta Sans (unified with sans)
- `font-mono` → JetBrains Mono (unchanged)

---

### 3. Density Rules

- **Compact data-dense workspace** — this is a developer-productivity tool; whitespace is intentional but never wasteful.
- **Spacing scale (rem-based, 4px base):**
  - `space-0`: 0
  - `space-1`: 0.25rem (4px)
  - `space-2`: 0.5rem (8px)
  - `space-3`: 0.75rem (12px)
  - `space-4`: 1rem (16px)
  - `space-5`: 1.25rem (20px)
  - `space-6`: 1.5rem (24px)
  - `space-8`: 2rem (32px)
  - `space-10`: 2.5rem (40px)
  - `space-12`: 3rem (48px)
- **Atom padding/margin:** 8px–12px internal padding for buttons, inputs, badges.
- **Molecule padding/margin:** 12px–16px internal padding for cards, panels, form fields.
- **Organism padding/margin:** 16px–24px internal padding for modals, slide panels, toolbars.
- **Layout gaps:** 0px between nav rail and sidebar; 8px–12px between sidebar and workspace; 16px inside workspace panels.

---

### 4. Responsive Rules

- **Mobile-first** — base styles target the smallest breakpoint; enhancements scale up.
- **Verification widths:** every layout change must be verified at exactly these viewport widths:
  - **375px** — small mobile (iPhone SE / mini)
  - **768px** — tablet / large mobile
  - **1024px** — small desktop / large tablet
  - **1440px** — standard desktop
- **No horizontal scroll at any width** — overflow must be handled via truncation, scrollable containers, or responsive reflow.
- **Sidebar behavior:** collapses to icon-only rail below 768px; fully hidden on 375px with hamburger toggle.
- **Canvas behavior:** maintains minimum usable node size (200px compact / 320px max) across all breakpoints; zoom controls adapt.

---

### 5. Elevation/Shadow Scale

Shadows must be theme-aware (different opacity/multiplier for light vs. dark).

| Level       | Light Mode                                                   | Dark Mode                                                   | Usage                            |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------- |
| **Flat**    | none                                                         | none                                                        | Base surfaces, inactive nodes    |
| **Raised**  | `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`     | `0 1px 3px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.15)`    | Cards, panels, buttons           |
| **Overlay** | `0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)`     | `0 4px 6px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.15)`    | Dropdowns, popovers, tooltips    |
| **Modal**   | `0 10px 25px rgba(0,0,0,0.1), 0 8px 10px rgba(0,0,0,0.04)`   | `0 10px 25px rgba(0,0,0,0.35), 0 8px 10px rgba(0,0,0,0.2)`  | Modals, dialogs, slide panels    |
| **Popover** | `0 20px 50px rgba(0,0,0,0.12), 0 12px 24px rgba(0,0,0,0.06)` | `0 20px 50px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.25)` | Context menus, floating palettes |

**Current token mapping (to be updated in Task 4):**

- `shadow-node` → Raised level
- `shadow-node-hover` → Overlay level
- `shadow-node-selected` → 2px ring (not a shadow; uses primary color at 50% opacity)

---

### 6. Radius Scale

| Token         | Value          | Usage                              |
| ------------- | -------------- | ---------------------------------- |
| `radius-sm`   | 0.25rem (4px)  | Small buttons, tags, inline inputs |
| `radius-md`   | 0.375rem (6px) | Default buttons, inputs, badges    |
| `radius-lg`   | 0.5rem (8px)   | Cards, panels, modals              |
| `radius-xl`   | 0.75rem (12px) | Large cards, feature containers    |
| `radius-full` | 9999px         | Pills, avatars, toggle switches    |

**Current values are preserved as baseline; contract confirms these exact values for redesign consistency.**

---

### 7. Motion/Transition Rules

| Token    | Duration | Easing      | Usage                                                                   |
| -------- | -------- | ----------- | ----------------------------------------------------------------------- |
| `fast`   | 150ms    | ease-in-out | Micro-interactions: button hovers, icon swaps, focus shifts             |
| `normal` | 300ms    | ease-in-out | Standard transitions: panel expand/collapse, tab switches, theme toggle |
| `slow`   | 500ms    | ease-in-out | Layout shifts: sidebar collapse, modal enter/exit, slide panels         |

- **All transitions use `ease-in-out`** for consistency.
- **`prefers-reduced-motion` fallback:** when the user has requested reduced motion, ALL nonessential animations are disabled. Essential feedback (focus rings, status changes) remain instant (0ms). No animated skeletons, no pulsing borders, no entrance animations.
- **Running node pulse** — the `animate-pulse-border` keyframe is considered nonessential and MUST be suppressed under `prefers-reduced-motion`.

---

### 8. Focus Ring Rules

- **2px ring/outline** — all interactive elements (buttons, inputs, links, checkboxes, radio buttons, tabs, nodes) must show a visible focus indicator.
- **Visible in both themes** — light mode uses primary-900 at 50% opacity; dark mode uses primary-400 at 50% opacity.
- **Contrast requirements:** focus rings and non-text UI elements (icons, borders, checkboxes) must achieve at least **3:1** contrast against adjacent colors.
- **`focus-visible` preferred over `focus`** — focus styles should only appear on keyboard navigation, not on mouse click.
- **Outline offset:** 2px from the element edge.
- **Border radius:** focus ring respects the element's border radius (sm/md/lg/xl/full).
- **Never remove focus indicators** — `outline: none` without a replacement is forbidden.

---

### 9. Status/Method Visualization

- **Multi-channel encoding** — success, error, warning, running, and info states must use a combination of:
  1. **Color** (semantic token)
  2. **Icon** (Lucide icon, distinct per status)
  3. **Text label** (where space permits)
  4. **Border/background shift** (subtle tint on container)
  5. **Elevation change** (raised shadow for active/running)
- **Never color alone** — a status indicator that relies solely on hue fails WCAG 1.4.1 (Use of Color).
- **HTTP methods** use distinct colors + uppercase text labels:
  - GET: green (`#16a34a`)
  - POST: blue (`#2563eb`)
  - PUT: orange (`#ea580c`)
  - PATCH: violet (`#7c3aed`)
  - DELETE: red (`#dc2626`)
  - HEAD: cyan (`#0e7490`)
  - OPTIONS: violet (`#7c3aed`)

---

### 10. Icon Rules

- **Lucide is the default icon set** — all UI icons MUST come from `lucide-react`. No exceptions.
- **No emoji as UI icons** — emojis (`🎨`, `🚀`, `⚙️`, etc.) are forbidden in any interface element. Use SVG icons exclusively.
- **Icon size scale:**
  - `xs`: 12px (inline with text, compact tables)
  - `sm`: 16px (buttons, badges, inline actions)
  - `md`: 20px (panel headers, form fields, navigation)
  - `lg`: 24px (empty states, feature illustrations)
  - `xl`: 32px (hero sections, large empty states)
- **Consistent viewBox:** all Lucide icons use 24×24 viewBox; scale via CSS `width`/`height` or Tailwind `w-*`/`h-*` classes.
- **Icon + text pairings:** always include `gap-2` (8px) between icon and label; vertically center with `items-center`.

---

### 11. Selected/Error/Running States

- **Selected state** — multi-channel:
  - 2px ring using primary color at 50% opacity
  - Background shift to `surface-overlay`
  - Elevation bump to Overlay shadow level
  - Optional: icon color change to primary
- **Error state** — multi-channel:
  - 2px ring using `status-error` at 50% opacity
  - Background tint using `status-error` at 5–10% opacity
  - Icon change to `XCircle` or `AlertTriangle`
  - Text label includes error message
- **Running state** — multi-channel:
  - Border color cycles via `animate-pulse-border` (yellow-500)
  - Background tint using `status-running` at 5–10% opacity
  - Icon shows `Loader2` with `animate-spin`
  - Text label shows "Running…" or progress indicator
  - **Pulse animation is disabled under `prefers-reduced-motion`** — border becomes solid yellow, no animation.

---

### 12. Forbidden Patterns

The following patterns are **explicitly forbidden** in the redesign and in all future code:

1. **No hardcoded hex/rgb in components** — all colors MUST reference design tokens (`colors.primary`, `var(--aw-*)`, Tailwind semantic classes). Token-definition files (`base.css`, `tailwind.config.js`) are the only exceptions.
2. **No `any` type** — TypeScript strict mode is non-negotiable. Every variable, prop, hook, and API response must have an explicit type.
3. **No manual save buttons** — all state changes trigger the 700ms debounced auto-save via `useAutoSave`. Manual "Save" or "Apply" buttons are forbidden.
4. **No WorkflowContext bypass** — all canvas state (nodes, edges, variables, settings, extractors) MUST flow through `WorkflowContext`. Direct mutation of ReactFlow internals or local state that shadows workflow state is forbidden.
5. **No emoji UI icons** — see Icon Rules above. Emojis are not accessible, not scalable, and not theme-aware.
6. **No color-only status** — status indicators MUST use color + icon + text + border/background (never hue alone).
7. **No raw duplicated styled patterns where atoms/molecules exist** — if a `Button`, `IconButton`, `Panel`, `FormField`, `Card`, `StatusBadge`, or `EmptyState` already exists, you MUST use it. Copy-pasting styled `div` soup is forbidden.
8. **No landing-page horizontal journey patterns in the app shell** — the app is a dense workspace, not a marketing page. Avoid full-width hero sections, scroll-jacking, or parallax inside the application chrome.
9. **No arbitrary magic numbers** — spacing, sizing, colors, shadows, and radii MUST use design tokens. Values like `margin: 13px`, `padding: 7px`, or `border-radius: 6px` (when not `radius-md`) are forbidden.
10. **No inline font-family declarations** — use `font-sans`, `font-display`, `font-mono` Tailwind classes exclusively.

---

## Usage Guidelines

1. **Prefer Tailwind utility classes** for component styling
2. **Use DaisyUI component classes** (`btn`, `badge`, `modal`, etc.) only when custom atoms don't cover the use case
3. **Use design tokens** (Tailwind `colors.primary`, `colors.surface`, etc.) instead of raw hex values
4. **Use CSS custom properties** (`var(--aw-*)`) only when raw CSS is needed (e.g., inline styles, ReactFlow edge colors)
5. **Dark mode**: Always use Tailwind `dark:` prefix — never hardcode colors for dark mode in components
6. **Fonts**: Use `font-sans` (default), `font-display` (headings), `font-mono` (code) — never inline font-family
7. **Keyboard shortcuts**: Bind via `useKeyboardShortcuts` hook — never use raw `addEventListener('keydown')` in components
8. **Loading states**: Use `Skeleton` atom for content placeholders, `Spinner` atom for action-in-progress indicators
9. **Console logging**: Strip all `console.log` from production paths. Guard necessary debug output behind `import.meta.env.DEV`
10. **TypeScript**: All components must have explicit types. No `any`. Use shared types from `src/types/`
11. **DRY**: If a pattern appears 2+ times, extract it into a reusable component
12. **Atomic Design**: Put components in the correct layer — atoms have no business logic, molecules compose atoms, organisms compose molecules

---

## Button System Reference

### Variants

| Variant     | Description         | Usage                    |
| ----------- | ------------------- | ------------------------ |
| `primary`   | Filled with shadow  | Main actions, CTAs       |
| `secondary` | Outlined with tint  | Secondary actions        |
| `ghost`     | Minimal, hover only | Tertiary actions, inline |

### Intents

| Intent    | Color          | Usage                       |
| --------- | -------------- | --------------------------- |
| `default` | Primary (cyan) | Standard actions            |
| `success` | Green          | Create, save, confirm       |
| `error`   | Red            | Delete, cancel, destructive |
| `warning` | Yellow/amber   | Caution actions             |
| `info`    | Blue           | Informational actions       |

### Sizes

| Size | Usage                               |
| ---- | ----------------------------------- |
| `xs` | Icon-only buttons, inline actions   |
| `sm` | Small inline buttons, table actions |
| `md` | Standard buttons, form actions      |
| `lg` | Large CTA buttons, hero actions     |

### Examples

```tsx
// Primary action button
<Button variant="primary" intent="success" size="md" onClick={handleSave}>
  Save
</Button>

// Icon-only button with tooltip
<IconButton icon={Save} tooltip="Save workflow" onClick={handleSave} />

// Ghost button for secondary actions
<Button variant="ghost" size="sm" onClick={handleCancel}>
  Cancel
</Button>

// Loading state
<Button variant="primary" loading={isSaving} onClick={handleSave}>
  {isSaving ? 'Saving...' : 'Save'}
</Button>
```

---

## Panel System Reference

### Panel

```tsx
<Panel
  title="Variables"
  icon={Package}
  collapsible
  defaultExpanded
  headerActions={
    <Button variant="ghost" size="xs">
      Clear All
    </Button>
  }
>
  <PanelTabs
    tabs={[
      { key: "variables", icon: Package, label: "Variables" },
      { key: "functions", icon: Sparkles, label: "Functions" },
    ]}
    activeTab={activeTab}
    onTabChange={setActiveTab}
  />
  <div className="p-4">{/* content */}</div>
</Panel>
```

### FormField

```tsx
<FormField
  label="URL"
  hint="Supports variables: {{prev.response.body.id}}"
  error={errors.url}
>
  <Input
    type="text"
    value={url}
    onChange={setUrl}
    placeholder="https://api.example.com"
  />
</FormField>
```

### Card

```tsx
<Card title="Configuration" icon={Settings} collapsible>
  <FormField label="Timeout">
    <Input type="number" value={timeout} onChange={setTimeout} />
  </FormField>
</Card>
```
