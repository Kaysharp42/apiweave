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
- Shared types live in `src/types/` — never duplicate type definitions

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

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `primary` | `#164e63` (cyan-900) | `#22d3ee` (cyan-400) | Primary actions, active states |
| `primary-light` | `#0e7490` (cyan-700) | `#06b6d4` (cyan-500) | Hover, secondary emphasis |
| `primary-hover` | `#155e75` (cyan-800) | `#67e8f9` (cyan-300) | Hover state |
| `primary-dark` | `#083344` (cyan-950) | — | Deep emphasis |

### Surfaces

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `surface` | `#f8fafc` (slate-50) | `#111827` (gray-900) | Page background |
| `surface-raised` | `#ffffff` | `#1f2937` (gray-800) | Cards, panels, modals |
| `surface-overlay` | `#f1f5f9` (slate-100) | `#1e293b` (gray-850) | Dropdowns, popovers |

### Text

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `text-primary` | `#111827` (gray-900) | `#f3f4f6` (gray-100) | Body text, headings |
| `text-secondary` | `#4b5563` (gray-600) | `#9ca3af` (gray-400) | Labels, descriptions |
| `text-muted` | `#9ca3af` (gray-400) | `#4b5563` (gray-600) | Placeholders, hints |

### Borders

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `border` | `#cbd5e1` (slate-300) | `#374151` (gray-700) | Default borders |
| `border-focus` | `#164e63` | `#22d3ee` | Focus ring borders |

### Status

| Token | Value | Usage |
|-------|-------|-------|
| `status-success` | `#16a34a` / `#4ade80` | Pass, success |
| `status-error` | `#dc2626` / `#f87171` | Fail, error |
| `status-warning` | `#f59e0b` / `#fbbf24` | Warning, caution |
| `status-running` | `#eab308` / `#facc15` | In-progress, executing |
| `status-info` | `#2563eb` / `#3b82f6` | Informational |

### HTTP Method Colors

| Method | Color | Hex |
|--------|-------|-----|
| GET | Green | `#16a34a` |
| POST | Blue | `#2563eb` |
| PUT | Orange | `#ea580c` |
| PATCH | Violet | `#7c3aed` |
| DELETE | Red | `#dc2626` |

---

## Typography

| Role | Font Family | Weights | Usage |
|------|-------------|---------|-------|
| **Body** | Open Sans | 300, 400, 500, 600, 700 | All body text, labels, inputs |
| **Display** | Montserrat | 500, 600, 700, 800 | Headings, logo, branding |
| **Code** | JetBrains Mono | 400, 500, 600 | Code blocks, JSON, URLs, monospace |

### Tailwind Classes
- Body text: `font-sans` (default)
- Headings: `font-display`
- Code: `font-mono`

---

## Spacing & Sizing

| Token | Value | Usage |
|-------|-------|-------|
| `header-height` | 48px | Main header |
| `footer-height` | 32px | Main footer |
| `nav-collapsed` | 56px | AppNavBar collapsed width |
| `nav-expanded` | 180px | AppNavBar expanded width |
| `sidebar-default` | 380px | Default sidebar width |
| `sidebar-max` | 600px | Max sidebar width |
| `node-compact` | 200px | Compact node width |
| `node-max` | 320px | Max node width |

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
document.documentElement.classList.add('dark');                    // Tailwind
document.documentElement.setAttribute('data-theme', 'apiweave-dark'); // DaisyUI
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

| Token | Usage |
|-------|-------|
| `shadow-node` | Default node shadow |
| `shadow-node-hover` | Node hover state |
| `shadow-node-selected` | Node selected ring |

---

## Animations

| Token | Usage |
|-------|-------|
| `animate-pulse-border` | Running/executing node border pulse |
| `--aw-transition-fast` | 150ms — micro-interactions |
| `--aw-transition-normal` | 300ms — standard transitions |
| `--aw-transition-slow` | 500ms — layout shifts |

---

## Component Inventory

### Atoms
| Component | File | Purpose |
|-----------|------|---------|
| `Button` | `atoms/Button.tsx` | Primary/secondary/ghost button with variant × intent × size matrix. Supports `loading`, `icon`, `fullWidth`, `disabled`. |
| `IconButton` | `atoms/IconButton.tsx` | Icon-only button with optional Tippy tooltip. Supports `size`, `variant`, `disabled`, `loading`. |
| `Input` | `atoms/Input.tsx` | Text input with proper focus ring, error state, and dark mode support. |
| `TextArea` | `atoms/TextArea.tsx` | Multi-line text input with resize control and dark mode support. |
| `Badge` | `atoms/Badge.tsx` | Status/info badge with `variant` (ghost/primary/success/error/warning/info) and `size` (xs/sm/md). |
| `Toggle` | `atoms/Toggle.tsx` | Toggle switch with label support and dark mode. |
| `Spinner` | `atoms/Spinner.tsx` | Loading spinner with `size` (xs/sm/md/lg) and optional `label`. |
| `Skeleton` | `atoms/Skeleton.tsx` | Loading placeholder with `variant` (text/circle/rect). |
| `Divider` | `atoms/Divider.tsx` | Horizontal/vertical divider line. |
| `Tooltip` | `atoms/Tooltip.tsx` | Tippy-based tooltip wrapper. |

### Molecules
| Component | File | Purpose |
|-----------|------|---------|
| `Panel` | `molecules/Panel.tsx` | Reusable panel shell with `title`, `icon`, `collapsible`, `headerActions`, `children`, `footer`. Used by all panel layouts. |
| `PanelTabs` | `molecules/PanelTabs.tsx` | Reusable tab bar for panels. Props: `tabs: { key, icon, label }[]`, `activeTab`, `onTabChange`. |
| `FormField` | `molecules/FormField.tsx` | Reusable form field wrapper with `label`, `hint`, `error`, `required`, `children`. Wraps any input. |
| `Card` | `molecules/Card.tsx` | Reusable card with `title`, `icon`, `headerActions`, `collapsible`, `children`. |
| `Modal` | `molecules/Modal.tsx` | Shared modal shell with Headless UI Dialog. Sizes: `sm`, `md`, `lg`, `xl`, `fullscreen`. |
| `ConfirmDialog` | `molecules/ConfirmDialog.tsx` | Confirmation dialog with `title`, `message`, `confirmLabel`, `intent`. |
| `PromptDialog` | `molecules/PromptDialog.tsx` | Text input prompt dialog with `title`, `message`, `placeholder`, `submitLabel`. |
| `EmptyState` | `molecules/EmptyState.tsx` | Reusable empty state with `icon`, `title`, `description`, `action`. |
| `WorkspaceEmptyState` | `molecules/WorkspaceEmptyState.tsx` | Workspace-level empty state with CTA to create workflow. |
| `SearchInput` | `molecules/SearchInput.tsx` | Search input with icon and clear button. |
| `KeyValueEditor` | `molecules/KeyValueEditor.tsx` | Key-value pair editor for headers, query params, etc. |
| `StatusBadge` | `molecules/StatusBadge.tsx` | Unified status indicator for runs, nodes, etc. |
| `SlidePanel` | `molecules/SlidePanel.tsx` | Slide-in panel for side content. |

### Organisms
| Component | File | Purpose |
|-----------|------|---------|
| `CanvasToolbar` | `organisms/CanvasToolbar.tsx` | Floating horizontal toolbar for the workflow canvas. Uses `Button`/`IconButton` atoms. |
| `TabBar` | `organisms/TabBar.tsx` | Workspace tab strip with scroll overflow, context menu, close buttons. |
| `KeyboardShortcutsHelp` | `organisms/KeyboardShortcutsHelp.tsx` | Modal displaying all keyboard shortcuts. Uses DaisyUI `kbd` elements. |

### Layout
| Component | File | Purpose |
|-----------|------|---------|
| `MainLayout` | `layout/MainLayout.tsx` | Top-level layout with AppNavBar, Sidebar, Workspace. |
| `AppNavBar` | `layout/AppNavBar.tsx` | Left icon navigation bar with collapse/expand. |
| `Sidebar` | `layout/Sidebar.tsx` | Workflow/collection list with search, pagination, actions. |
| `SidebarHeader` | `layout/SidebarHeader.tsx` | Sidebar header with breadcrumb, actions, search. |
| `MainHeader` | `layout/MainHeader.tsx` | Top header bar with logo, environment, theme controls. |
| `MainFooter` | `layout/MainFooter.tsx` | Bottom status bar. |
| `Workspace` | `layout/Workspace.tsx` | Main workspace area with tabs, canvas, side panels. |

### Nodes (ReactFlow)
| Component | File | Purpose |
|-----------|------|---------|
| `BaseNode` | `atoms/flow/BaseNode.tsx` | Shared node shell for all ReactFlow nodes. |
| `NodeHandle` | `atoms/flow/NodeHandle.tsx` | Typed connection handle. |
| `NodeActionMenu` | `atoms/flow/NodeActionMenu.tsx` | Three-dot context menu for nodes. |
| `HTTPRequestNode` | `nodes/HTTPRequestNode.tsx` | HTTP request node with method, URL, headers, body, extractors. |
| `AssertionNode` | `nodes/AssertionNode.tsx` | Assertion node for response validation. |
| `DelayNode` | `nodes/DelayNode.tsx` | Delay node for timing control. |
| `MergeNode` | `nodes/MergeNode.tsx` | Merge node for parallel branch synchronization. |
| `StartNode` | `nodes/StartNode.tsx` | Workflow start node. |
| `EndNode` | `nodes/EndNode.tsx` | Workflow end node. |

### Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.ts` | Global keyboard shortcut bindings via Mousetrap. |
| `useWorkflowPolling` | `hooks/useWorkflowPolling.ts` | Workflow run polling with adaptive intervals. |
| `useCanvasDrop` | `hooks/useCanvasDrop.ts` | Canvas drag-and-drop handling. |
| `useAutoSave` | `hooks/useAutoSave.ts` | Auto-save behavior with debounce. |

### Accessibility Enhancements
- `role="toolbar"` on `CanvasToolbar`
- `role="main" aria-label="Workflow canvas"` on `WorkflowCanvas`
- `role="complementary" aria-label="Sidebar"` on `Sidebar`
- `aria-label="Main navigation"` on `AppNavBar` nav element
- `aria-hidden="true"` on decorative `Skeleton` elements
- All interactive buttons have explicit `title` attributes
- Focus management in modals via Headless UI

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
│   │   └── index.ts           — Shared TypeScript interfaces and types
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
│       │   ├── Sidebar.tsx        — Workflow/collection list
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
| Variant | Description | Usage |
|---------|-------------|-------|
| `primary` | Filled with shadow | Main actions, CTAs |
| `secondary` | Outlined with tint | Secondary actions |
| `ghost` | Minimal, hover only | Tertiary actions, inline |

### Intents
| Intent | Color | Usage |
|--------|-------|-------|
| `default` | Primary (cyan) | Standard actions |
| `success` | Green | Create, save, confirm |
| `error` | Red | Delete, cancel, destructive |
| `warning` | Yellow/amber | Caution actions |
| `info` | Blue | Informational actions |

### Sizes
| Size | Usage |
|------|-------|
| `xs` | Icon-only buttons, inline actions |
| `sm` | Small inline buttons, table actions |
| `md` | Standard buttons, form actions |
| `lg` | Large CTA buttons, hero actions |

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
  headerActions={<Button variant="ghost" size="xs">Clear All</Button>}
>
  <PanelTabs
    tabs={[
      { key: 'variables', icon: Package, label: 'Variables' },
      { key: 'functions', icon: Sparkles, label: 'Functions' },
    ]}
    activeTab={activeTab}
    onTabChange={setActiveTab}
  />
  <div className="p-4">{/* content */}</div>
</Panel>
```

### FormField
```tsx
<FormField label="URL" hint="Supports variables: {{prev.response.body.id}}" error={errors.url}>
  <Input type="text" value={url} onChange={setUrl} placeholder="https://api.example.com" />
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
