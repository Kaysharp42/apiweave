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
