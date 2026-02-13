# APIWeave Design System

> **Established:** 2026-02-09 (Phase 1)
> **Component Library:** DaisyUI 5.x (Tailwind CSS plugin)
> **Architecture:** Atomic Design (atoms → molecules → organisms → pages)

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
| `sidebar-default` | 450px | Default sidebar width |
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
The `App.jsx` component manages both:
1. Tailwind `dark:` class on `<html>` — for Tailwind utility dark variants
2. DaisyUI `data-theme` attribute — for DaisyUI component theming

```jsx
// In App.jsx useEffect
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

## Component Inventory (Phase 10)

### Atoms
| Component | File | Purpose |
|-----------|------|---------|
| `Skeleton` | `atoms/Skeleton.jsx` | DaisyUI skeleton loading placeholder. Supports `variant` (text/circle/rect), `width`, `height`, `count`, `className`. |
| `Spinner` | `atoms/Spinner.jsx` | DaisyUI loading spinner with configurable `size` (xs–lg) and optional `label`. |

### Organisms
| Component | File | Purpose |
|-----------|------|---------|
| `CanvasToolbar` | `organisms/CanvasToolbar.jsx` | Floating horizontal toolbar for the workflow canvas. Contains zoom, run, environment selector, import, variables, history, and JSON editor buttons. Uses DaisyUI `btn-group` with design tokens. |
| `KeyboardShortcutsHelp` | `organisms/KeyboardShortcutsHelp.jsx` | Modal displaying all keyboard shortcuts grouped by category (General, Tabs, Panels, Canvas). Uses DaisyUI `kbd` elements. |

### Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.js` | Global keyboard shortcut bindings via Mousetrap. Binds Ctrl+N/S/R/W/E/J/B and `?`. Uses ref pattern to keep callbacks fresh without rebinding. |

### Accessibility Enhancements
- `role="toolbar"` on `CanvasToolbar`
- `role="main" aria-label="Workflow canvas"` on `WorkflowCanvas`
- `role="complementary" aria-label="Sidebar"` on `Sidebar`
- `aria-label="Main navigation"` on `AppNavBar` nav element
- `aria-hidden="true"` on decorative `Skeleton` elements
- All interactive buttons have explicit `title` attributes

---

## File Structure

```
frontend/
├── tailwind.config.js       — Design tokens, DaisyUI config, custom themes
├── index.html               — Google Fonts import
├── src/
│   ├── index.css            — Tailwind directives + ReactFlow dark mode overrides
│   ├── styles/
│   │   └── base.css         — CSS custom properties, global resets, scrollbar styling
│   └── components/
│       ├── atoms/
│       │   ├── Skeleton.jsx — Loading placeholder
│       │   ├── Spinner.jsx  — Loading spinner
│       │   └── index.js     — Barrel exports
│       ├── organisms/
│       │   ├── CanvasToolbar.jsx         — Canvas floating toolbar
│       │   ├── KeyboardShortcutsHelp.jsx — Shortcut help modal
│       │   └── index.js                  — Barrel exports
│       └── hooks/
│           └── useKeyboardShortcuts.js   — Global shortcut bindings
```

---

## Usage Guidelines

1. **Prefer Tailwind utility classes** for component styling
2. **Use DaisyUI component classes** (`btn`, `badge`, `modal`, etc.) for interactive elements
3. **Use design tokens** (Tailwind `colors.primary`, `colors.surface`, etc.) instead of raw hex values
4. **Use CSS custom properties** (`var(--aw-*)`) only when raw CSS is needed (e.g., inline styles, ReactFlow edge colors)
5. **Dark mode**: Always use Tailwind `dark:` prefix — never hardcode colors for dark mode in components
6. **Fonts**: Use `font-sans` (default), `font-display` (headings), `font-mono` (code) — never inline font-family
7. **Keyboard shortcuts**: Bind via `useKeyboardShortcuts` hook — never use raw `addEventListener('keydown')` in components
8. **Loading states**: Use `Skeleton` atom for content placeholders, `Spinner` atom for action-in-progress indicators
9. **Console logging**: Strip all `console.log` from production paths. Guard necessary debug output behind `import.meta.env.DEV`
