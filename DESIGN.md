---
name: APIWeave
description: "Visual API Test Workflow Builder — product UI for a developer tool"
colors:
  primary: "#0d5c6e"
  primary-light: "#0f766e"
  primary-hover: "#0b4a59"
  primary-dark: "#0b3d49"
  surface: "#fafafa"
  surface-raised: "#ffffff"
  surface-overlay: "#f4f4f5"
  surface-dark: "#09090b"
  surface-dark-raised: "#18181b"
  surface-dark-overlay: "#27272a"
  text-primary: "#09090b"
  text-secondary: "#5f5f60"
  text-muted: "#909091"
  text-primary-dark: "#fafafa"
  text-secondary-dark: "#ababac"
  text-muted-dark: "#7e7e7f"
  border: "#e6e6e7"
  border-dark: "#2f2f31"
  border-focus: "#0d5c6e"
  border-focus-dark: "#2dd4bf"
  status-success: "#15803d"
  status-error: "#b91c1c"
  status-warning: "#b45309"
  status-running: "#a16207"
  status-info: "#1d4ed8"
  method-get: "#15803d"
  method-post: "#1d4ed8"
  method-put: "#b45309"
  method-patch: "#6d28d9"
  method-delete: "#b91c1c"
  method-head: "#0f766e"
  method-options: "#6d28d9"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.5rem, 2vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.25
  headline:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.25rem, 1.5vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0px"
  md: "0.125rem"
  lg: "0.25rem"
  xl: "0.5rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0 0.75rem"
    height: "2.5rem"
  nav-rail:
    backgroundColor: "{colors.surface-dark}"
    width: "56px"
  sidebar:
    backgroundColor: "{colors.surface}"
    width: "380px"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1rem"
---

# Design System: APIWeave

## 1. Overview

**Creative North Star: "The API Craftsman"**

APIWeave is a developer tool for building visual API test workflows. Its design philosophy descends from the workshop, not the gallery: every surface exists to make the tool disappear into the task. The interface is a workbench — organized, well-lit, with every instrument within reach and nothing decorative on the table.

The system rests on a foundation of **earned familiarity.** Users should sit down and trust this interface within seconds because it behaves like the best tools they already use: consistent affordances, predictable navigation, density without clutter. The palette is restrained — zinc-neutral surfaces with a single ink-teal accent used sparingly to signal primary actions, active states, and focus. Shadows are minimal (separation comes from hairline borders, not elevation). Typography runs on one family (Inter) across the entire surface; JetBrains Mono is reserved for code, JSON, and URLs.

The Swiss-minimalist tradition is the root, but this is not a design exercise — it's a production tool for API engineers who spend hours in it. Every pixel is justified by the task.

**Key Characteristics:**
- **Restrained palette** — zinc neutrals + one ink-teal accent, used at ≤10% of any given screen
- **One-family typography** — Inter carries body, headlines, labels, and UI. JetBrains Mono reserved for code
- **Hairline borders over shadows** — separation via 1px zinc-200/800 lines, not drop shadows
- **Compact density** — developer tool pacing: information-dense but never cramped
- **Balanced light/dark mode** — both are first-class; light mode is not an afterthought
- **State-rich semantics** — every interactive element defines default, hover, focus, active, disabled, loading, and error

## 2. Colors

The palette is intentionally restrained. One ink-teal accent on a zinc-neutral base. Color saturation is reserved for semantic meaning — status, method, state — never decoration.

### Primary

- **Ink-Teal** (#0d5c6e / oklch(40% 0.045 195)): The sole accent color. Used for primary buttons, focus rings, active navigation items, and selected nodes. Never decorative. In dark mode, shifts to a luminous teal (#2dd4bf) for readability on the dark zinc surface.

### Neutral

**One tint, three alphas.** A theme owns exactly two things: one ink tint
(`--aw-tint-rgb`) and three surface channel triples. Every quiet neutral role
— hairline borders, secondary text, muted text — is an alpha of that tint, so
flipping the theme is one value and not a parallel palette that can drift.
Anything that needs a *hex* per theme (strong ink, the accent, status, methods)
says so explicitly. `src/styles/base.css` is the only file where a neutral
value is written down; `tailwind.config.js` resolves through it.

- **Ink tint** (`9 9 11` light / `250 250 250` dark): zinc-950 and zinc-50 as
  channels. The one value a theme flip changes.
- **Zinc-50** (#fafafa): Page background in light mode. Near-white, cool-neutral, minimal chroma.
- **White** (#ffffff): Raised surfaces — cards, panels, modals — in light mode.
- **Zinc-100** (#f4f4f5): Overlay/hover backgrounds in light mode. Dropdowns, popovers.
- **Zinc-950** (#09090b): Dark mode page background. Near-black, cool-neutral.
- **Zinc-900** (#18181b): Dark mode raised surfaces.
- **Zinc-800** (#27272a): Dark mode overlay/hover background.
- **Hairline** (tint at 10%): Border colour in both themes. An alpha rather
  than a hex because a border sits over whatever surface is behind it. It is
  deliberately not the same value as the overlay fill — the two roles collided
  at #27272a in dark under the old paired palettes, which made a hover fill
  grow a visible edge.

### Text

- **Ink** (#09090b / #fafafa dark): Primary text, headings. The one text role that stays a hex. Full contrast against respective surfaces; body text passes 4.5:1 minimum.
- **Mist** (tint at 65%): Secondary text — labels, descriptions, metadata. 6.4:1 on white, 7.7:1 on zinc-900. Carries content, so it holds the 4.5:1 body floor.
- **Dust** (tint at 45%): Placeholder text, hints, disabled content. **3.2:1 on white** — it clears the 3:1 non-text floor but not 4.5:1. Use it only where the meaning survives not reading it: an input placeholder beside a label, a disabled control. Never for content. The node layer needs muted *content* — the metrics row, the rest line's argument — so it uses `--aw-node-text-muted` (zinc-500, 4.83:1) instead.
- **Enforcement:** `src/styles/__tests__/theme-contrast.test.ts` computes every text/surface pair in both themes from `base.css` itself, and `src/components/__tests__/node-layer-contrast.test.ts` applies the tighter node-layer floors. Retuning an alpha is safe because those two tests recompute; changing one without running them is not.

### Semantic Status

- **Success** (#15803d): Passed assertions, completed runs, positive confirmation.
- **Error** (#b91c1c): Failed assertions, error states, destructive actions.
- **Warning** (#b45309): Caution, rate-limit warnings, degraded status.
- **Running** (#a16207): In-progress execution. On the node layer it carries the breathing glow and the spinner affordance. Amber deliberately differs from Success green so that running and finished are distinguishable by hue alone, in a still frame, with no motion.
- **Info** (#1d4ed8): Informational badges, help text indicators.

All status colors are paired with distinct icons and text labels — never encoded by hue alone.

### HTTP Method Colors

- GET: green (#15803d), POST: blue (#1d4ed8), PUT: orange (#b45309), PATCH: violet (#6d28d9), DELETE: red (#b91c1c), HEAD: teal (#0f766e), OPTIONS: violet (#6d28d9)

### Named Rules

**The One Voice Rule.** The ink-teal accent is used on ≤10% of any given screen. Its rarity is the point — when the user sees it, they know it means "act here" or "this is current."

**The Status-Only Saturation Rule.** Fully saturated colors (green, red, amber, blue, yellow) are reserved exclusively for semantic status and HTTP methods. They never appear as decorative accents, backgrounds, or branding flourishes.

## 3. Typography

**Display & Body Font:** Inter (300–800 weights, with system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto fallbacks)
**Code Font:** JetBrains Mono (400–600 weights, with Fira Code, Consolas, monospace fallbacks)

**Character:** A single-family system. Inter's large x-height and open apertures keep UI text readable at small sizes without forcing a second family for headings. The pairing of Inter with JetBrains Mono provides a clear semantic boundary: proportional = UI, monospace = code/JSON/URLs. No serif, no display faces — this is a tool, not a magazine.

### Hierarchy

- **Display** (Semibold 600, clamp(1.5rem, 2vw, 2.25rem), line-height 1.25): Page-level headings — workflow names, feature titles. Used sparingly; most pages never need this.
- **Headline** (Semibold 600, clamp(1.25rem, 1.5vw, 1.875rem), line-height 1.3): Section titles within the workspace. Distinguishable from Display by size only.
- **Title** (Semibold 600, 1rem, line-height 1.4): Panel headers, card titles, dialog headings. The most frequently used heading step.
- **Body** (Regular 400, 0.875rem, line-height 1.5): All body text, table content, node content. Max line length 65–75ch where it flows as prose; data-dense layouts may exceed this.
- **Label** (Medium 500, 0.75rem, line-height 1.4): Button labels, form field labels, badges, tabs, table headers. The compact workhorse step.
- **Mono** (Regular 400, 0.8125rem, line-height 1.5): Code blocks, JSON viewers, URLs, variable expressions, monospace contexts only.

### Named Rules

**The One-Family Rule.** Inter is the only proportional font. Display, headline, title, body, and label all use Inter at different weights and sizes. The absence of a display-face pairing is intentional — a developer tool should not shout.

**The Tight Scale Rule.** The ratio between typographic steps is ≤1.2. No exaggerated display steps; the difference between "title" and "headline" is functional, not dramatic.

## 4. Elevation

The system uses a **flat-by-default, shadow-as-response** model. Surfaces are separated by hairline borders (1px, zinc-200 light / zinc-800 dark), not by elevation. Shadows appear only as a response to state: hover, active, or modal overlay.

In dark mode, shadow opacity increases to maintain separation against the near-black background, but the structural principle is the same: borders first, shadows second.

### Shadow Vocabulary

- **Raised** (`none`): All surfaces at rest — cards, panels, buttons, sidebar. Flat by default.
- **Node** (`0 1px 2px rgba(0, 0, 0, 0.04)`): Default workflow node shadow. Barely perceptible; nodes are separated by their border and background, not their shadow.
- **Overlay** (`0 2px 8px rgba(0, 0, 0, 0.04)` / dark: `0 2px 8px rgba(0, 0, 0, 0.25)`): Dropdowns, popovers, hover-state cards. The first and most common shadow tier.
- **Modal** (`0 8px 24px rgba(0, 0, 0, 0.08)` / dark: `0 8px 24px rgba(0, 0, 0, 0.35)`): Modals, dialogs, slide panels. Full viewport overlay backdrop.
- **Popover** (`0 12px 32px rgba(0, 0, 0, 0.10)` / dark: `0 12px 32px rgba(0, 0, 0, 0.40)`): Context menus, floating palettes, the highest-priority float layer.

### Node Layer Vocabulary

The node layer adds two tokens the chrome does not use:

- **Node Raised** (`--aw-shadow-node-raised`): an inner 1px top highlight plus a soft drop. What makes a node slab read as a lit object rather than a flat rectangle. Carried by every node, including idle ones.
- **Glow** (`--aw-glow-running` / `-error` / `-warning` / `-success` / `-select`): a 1px colored ring plus a soft colored halo, each `color-mix`ed from the status token it names. **A state signal, never a decoration.** Only non-idle or selected nodes carry one.

### Named Rules

**The Flat-By-Default Rule.** Surfaces at rest have no shadow. A card on the page is separated from the page by its 1px border, not by elevation. Shadows appear only on interaction — hover, focus, open state. **Scope: the app chrome.** The node layer is exempt (see §7) — a node carries `--aw-shadow-node-raised` at rest and a glow when its state warrants one. The rule still binds everything outside the canvas.

## 5. Components

### Buttons

- **Shape:** Gently rounded corners (0.25rem / 4px radius). Compact internal padding — xs: 8px/4px, sm: 12px/6px, md: 16px/8px, lg: 24px/12px.
- **Primary:** Ink-Teal background (#0d5c6e light / #2dd4bf dark) with white text. Inline-flex centered with 8px gap. Flat at rest, gains an overlay shadow on hover.
- **Secondary:** Transparent background with 1px ink-teal border and tinted 5% background. Same shape and padding. Used for secondary CTAs.
- **Ghost:** No border, no background. Ink text only. Background appears only on hover (zinc-100 overlay). For tertiary/inline actions.
- **States:** Focus-visible shows a 2px ink-teal outline at 2px offset. Disabled reduces opacity to 50%. Loading swaps text for a Spinner icon.
- **Intent colors:** Default ink-teal, success green, error red, warning amber, info blue. Semantic intents change only the color, not the shape or behavior.

### Inputs & Fields

- **Style:** Hairline border (1px, zinc-200 / zinc-800), near-white background, near-black text. Near-zero radius (0.125rem). Height 2.5rem at default size.
- **Focus:** Border shifts to ink-teal. 2px outline ring using ink-teal at 2px offset.
- **Error:** Red border (#b91c1c). Error message appears below the field in red at 0.75rem.
- **Disabled:** 50% opacity, no interactive states. Background shifts to zinc-100/zinc-800.
- **Placeholder:** Dust text color (#a1a1aa / #71717a) — always ≥4.5:1 against the input background.

### Cards

- **Corner Style:** Near-zero radius (0.125rem). Hairline border.
- **Background:** White in light mode / zinc-900 in dark mode.
- **Shadow Strategy:** Flat at rest (Raised: none). No default card shadow.
- **Internal Padding:** 0.75rem horizontally, 0.625rem vertically for the header; 1rem for body content.
- **Header:** Horizontal flex row with icon, title, and right-aligned actions. 1px bottom border separators.

### Navigation

- **AppNavBar (left rail):** Fixed 56px width. Dark background (zinc-950). Icon-only navigation with Lucide icons. Active state uses ink-teal icon color; inactive uses mocca-mist text color. Hover expands a brief tooltip via Tippy. Collapses to 56px always (no expandable mode).
- **Sidebar:** 380px default width (max 600px). Zinc-50 background in light mode (slightly dimmer than the page). Contains searchable workflow/project list. Uses Allotment split-pane for resizable boundaries.
- **MainHeader:** 48px height. Contains logo/branding, environment selector, theme toggle. Spans full width above workspace.
- **MainFooter:** 32px height. Status bar with execution state, connection status. Minimal.

### Side Panels

- **Structure:** one column — a header that stays put (title, search, panel-level affordances), then a single scroll region that takes the remaining height. A panel's own `h-full` only works when its parent gives it a `min-h-0 flex-1` slot; a panel dropped next to a tab bar inside a plain `overflow-hidden` box will silently push its own last rows out of reach.
- **Reference content is on demand, not chrome.** A 320px panel has no vertical space to spend on a permanent tips or cheat-sheet footer — it steals height from the content the user came for, and it sits below the fold where nobody reads it. Put it behind a `PanelTipsButton` in the header and render it as a `PanelTipsSheet` over the panel body: full height, its own scroll, Esc to close.
- **Discoverability:** the tips trigger carries a single accent dot until the user opens it once (persisted per panel in localStorage). One nudge, never a recurring one.
- **Never** stack two scroll regions in a side panel, and never let a static footer own more than one line of it.

### Nodes (ReactFlow)

The node layer is governed by its own doctrine — see §7, "The Node Layer: The Living Run." The entries below are that doctrine's component-level form.

- **Shape:** Soft-cornered slab (180px min, 320px max width). Hairline border. `--aw-radius-node` (14px) — the node layer is the one place in the app with a visible corner radius, and it uses a scoped `--aw-radius-node*` family so the chrome's near-zero radius is untouched.
- **BaseNode shell** provides a header (28px icon tile + title + type chip + one status affordance), an optional run strip, and connection handles.
- **Rest state is quiet.** A collapsed node shows the icon tile, the title, and one muted rest line identifying it (`POST api.shop.dev/auth/login`, `2 assertions`, `waits 1.5s`). Configuration — method select, URL input, assertion list — lives one chevron away, not on the canvas at rest.
- **Color coding by node type:** the icon tile carries the type hue as a 12% tint with the icon at full hue. Method/type identity also appears as a chip in the header. Hues come from the existing method and status tokens; the redesign introduces none.
- **States:** Default = flat, no glow, no animation. Running = amber border + breathing glow layer + run strip. Success = calm green border, glow settles away over 600ms. Error = red border + glow that persists. Skipped = hairline border + dash affordance, never a check. Selected = ink-teal ring, composing with any state glow.
- **One fact, one rendering.** A node's status is drawn once, as a single 16px affordance (hollow ring / spinner / check / ✗ / ⟳ / dash) plus the border and glow that state implies. Not as a badge *and* a dot *and* an icon.

### Connections (ReactFlow)

- **Path:** bezier curves, not orthogonal steps. Multiple edges leaving one node fan out from a single source point.
- **State:** an edge takes its state from its source node. Idle = 1px hairline. Active = 1.5px amber with a single bright dot travelling source→target. Traversed = 1.5px green at 55%. Failed = 1.5px red. Skipped = dashed hairline. Assertion pass/fail branches keep their semantic colors.
- **Handles:** 8px neutral sockets at rest — a resting handle reads as a socket, not a button. Lit to ink-teal on node hover or while connecting, and to the edge's state color when a live edge is attached. The visual size is never the hit area; a transparent 20px box is.
- **Midpoint affordance:** an insert `+` and a delete `×`, revealed on edge hover **or keyboard focus**, and reachable by tab.
- **Backdrop:** the dot grid stays. It is felt, not read — `--aw-text-muted` at 22%, 20px gap.

## 6. Do's and Don'ts

### Do:

- **Do** use the ink-teal accent sparingly — primary buttons, active states, focus rings only.
- **Do** separate surfaces with hairline borders (1px) before considering shadows.
- **Do** keep all proportional text in Inter regardless of role or weight. One family.
- **Do** use JetBrains Mono exclusively for code, JSON, URLs, monospace expressions.
- **Do** use multi-channel status encoding — never hue alone. Pair color with a distinct glyph, and with a text label wherever space permits. Multi-channel means *legible without color*, not the same fact drawn three times: on the node layer one status affordance plus the border and glow is the complete rendering.
- **Do** use Lucide icons from `lucide-react` exclusively. Never emoji.
- **Do** use existing atoms and molecules (Button, IconButton, Panel, FormField, Card, StatusBadge, EmptyState) instead of raw styled divs.
- **Do** use the tight spacing scale (4px base, 8px/12px/16px/24px/32px steps) for consistency.
- **Do** use `focus-visible` over `focus` — focus indicators on keyboard navigation only.
- **Do** respect `prefers-reduced-motion` — disable all non-essential animations.

### Don't:

- **Don't** use the ink-teal accent decoratively — no gradient text, no glassmorphism, no side-stripe accents. On the canvas the accent means "you can touch this": selection, handles, and the insert affordance. It never means "this is executing."
- **Don't** use fully saturated colors except for semantic status and HTTP methods. No decorative reds, greens, or blues.
- **Don't** use display fonts or serif fonts anywhere in the UI. Inter covers everything proportional.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe on cards, list items, or callouts.
- **Don't** use gradient text (`background-clip: text` with a gradient). Single solid colors only.
- **Don't** use glassmorphism (backdrop-filter blur) as a decorative default.
- **Don't** use hero-metric templates (big number + small label + gradient accent).
- **Don't** use identical card grids with icon + heading + text repeated endlessly.
- **Don't** use manual save buttons — 700ms debounced auto-save only.
- **Don't** bypass WorkflowContext for canvas state — all state flows through it.
- **Don't** use `any` types — TypeScript strict mode is enforced project-wide.
- **Don't** hardcode hex/rgb values in components — reference design tokens only.
- **Don't** use emoji as UI icons — Lucide SVG icons only.
- **Don't** show orchestrated page-load animations or choreographed entrance sequences. Users are in flow. Motion that *reports state* is not decoration and is not covered by this ban: a node breathes because a request is in flight, an edge carries a dot because control is passing through it. Nothing on the canvas animates that isn't reporting state, and nothing loops under `prefers-reduced-motion`.
- **Don't** apply glow, colored halos, or looping animation to the app chrome, or to a canvas node that is idle. Glow is a state signal on the node layer only (§4, §7).
- **Don't** use modals as the first interaction pattern — exhaust inline and progressive alternatives first.

## 7. The Node Layer: The Living Run

The workflow canvas is the one place in APIWeave where the Swiss doctrine above is deliberately relaxed. This section records the exception, its boundaries, and why it exists.

**The problem.** The chrome's job is to disappear. The canvas's job is the opposite: it is the only surface in the app that shows something *happening over time*. Rendered under pure chrome doctrine — 0-radius rectangles, hairline borders, flat at rest, no motion — a canvas mid-run looks exactly like a canvas at rest. The information is all present and all inert. Status becomes something you read rather than something you notice.

**The doctrine.** On the node layer only:

1. **Light means life.** Glow, saturation, and motion belong to nodes that are executing or just finished. An idle node is flat and cheap to render. This is the aesthetic rule and the performance rule at once — glow count is bounded by run concurrency, not by node count.
2. **Quiet at rest, informative in motion.** The node body is a stage, not a form. At rest it shows identity. During and after a run it shows what happened. Configuration lives one chevron away.
3. **Motion explains causality.** Nothing animates that isn't reporting state.

**Success settles, failure persists.** When a node succeeds its glow fades away over 600ms and the node returns to calm. When a node fails its glow holds indefinitely. On a finished canvas the only lit thing is what went wrong.

**Where the exception stops.** It covers `components/nodes/`, `components/atoms/flow/`, `CustomEdge`, and the canvas backdrop's dot color. It does **not** cover the title bar, nav rail, header, sidebar, footer, tab bar, the node modal, or any atom or molecule outside the node tree. Those keep chrome doctrine in full. The radius tokens are scoped (`--aw-radius-node*`) precisely so this boundary is enforced by the token names rather than by discipline.

**Accepted consequence.** The canvas reads softer than the chrome around it. That is the point: the canvas is the stage. Whether to escalate the radius scale app-wide is a separate question, deliberately left open.

**Non-negotiables.** Only `transform`, `opacity`, and `box-shadow` on a dedicated layer animate — never `width`, `height`, `top`, `left`, or `border-color` in a loop. Every looping animation is gated behind `prefers-reduced-motion`, and under reduced motion every state remains fully legible from color, glyph, and copy alone.
