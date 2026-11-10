# APIWeave — Project Context & Agent Rules

> This file MUST be read by every agent before making any changes to the codebase.
> It defines the architecture standards, coding rules, and workflow that ALL agents must follow.

---

## Project Overview

**APIWeave** is a Visual API Test Story Builder — a local-first Electron desktop app for creating, managing, and running API testing workflows visually. It consists of:

- **Renderer**: React + TypeScript + Tailwind CSS + daisyUI + ReactFlow (workflow canvas)
- **Main process**: Electron + TypeScript + better-sqlite3 (workflow execution, IPC handlers, local store)
- **Local MCP bridge**: loopback HTTP server on `127.0.0.1`, opt-in, exposes the IPC handler registry as a second transport
- **PTY host**: an Electron utility process (`app/electron/pty_host.ts`) that owns the pseudoterminals of embedded coding agents and streams their output to the renderer over a `MessagePort`
- **Headless CLI**: `apiweave run` (`app/core/cli/`), plain Node with no Electron
- **Architecture (renderer)**: Atomic Design (atoms → molecules → organisms → layout → pages)

There is no separate backend, no MongoDB, no FastAPI, no worker. Everything is on your machine.

---

## MANDATORY Rules (All Agents Must Follow)

### 1. TypeScript Strict Mode

- ALL frontend files MUST be `.ts` or `.tsx` — no `.js` or `.jsx` allowed
- `tsconfig.json` strict mode is enabled — violations are errors, not warnings
- NO `any` types — use proper interfaces, unions, generics, or `unknown`
- ALL props, state, hooks, stores, contexts, and API calls MUST have explicit types
- Shared types live in `src/types/` — NEVER duplicate type definitions across files
- **ONE type per file**: Every shared or exported type, interface, or union MUST be in its own file under `src/types/` named after the type (e.g., `Workflow.ts`, `ButtonProps.ts`). The `index.ts` barrel export re-exports all types. A component's own, non-exported `Props` interface used only in that file may stay beside the component; as soon as another file needs it, move it to `src/types/`.
- Enable: `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`

### 2. Reusable Components (DRY — Don't Repeat Yourself)

- **NEVER** duplicate button styles — always use `Button` or `IconButton` atoms
- **NEVER** duplicate panel layouts — always use `Panel` molecule
- **NEVER** duplicate form field patterns — always use `FormField` molecule
- **NEVER** duplicate card/section patterns — always use `Card` molecule
- **NEVER** duplicate tab patterns — always use `PanelTabs` molecule
- **NEVER** duplicate empty states — always use `EmptyState` molecule
- **NEVER** duplicate status badges — always use `StatusBadge` molecule
- If a visual pattern appears **2 or more times**, extract it into a reusable component
- All reusable components accept **props for customization** — no hardcoded content, labels, or colors

### 3. Atomic Design Structure

```text
app/src/
  types/              — Shared TypeScript interfaces and types
  components/
    atoms/            — Button, Input, Badge, Spinner, Toggle, etc. (no business logic)
    molecules/        — Modal, FormField, Panel, Card, EmptyState (compositions of atoms)
    organisms/        — CanvasToolbar, TabBar, KeyboardShortcutsHelp (complex UI sections)
    layout/           — MainLayout, Sidebar, MainHeader, Workspace (page structure)
    nodes/            — HTTPRequestNode, AssertionNode, etc. (ReactFlow nodes)
  hooks/              — Custom React hooks
  stores/             — Zustand stores
  contexts/           — React contexts (WorkflowContext, PaletteContext)
  pages/              — Page components (Home, WorkflowEditor)
  utils/              — Utility functions
  constants/          — Constant values
  styles/             — CSS files (base.css, design tokens)
```

### 4. Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `Button.tsx`, `FormField.tsx` |
| Props interfaces | PascalCase + `Props` suffix | `ButtonProps`, `PanelProps` |
| Types | PascalCase | `Workflow`, `NodeConfig`, `ButtonVariant` |
| Hooks | camelCase + `use` prefix | `useWorkflowPolling.ts` |
| Stores | PascalCase + `Store` suffix | `SidebarStore.ts` |
| Utils | camelCase | `sidebarItemLabel.ts` |
| Constants | PascalCase | `AppNavBar.ts` |
| Type files | `index.ts` barrel exports | `types/index.ts` |

### 5. Styling Rules

- Use **Tailwind utility classes** exclusively — no CSS-in-JS, no styled-components
- Use **design tokens** — NEVER hardcoded hex values:
  - `bg-primary`, `text-text-secondary`, `border-border`, `bg-surface-raised`
  - See the `@theme` block in `src/index.css` and `src/styles/base.css` for all tokens
- **Dark mode**: always use `dark:` prefix — never separate dark mode files or hardcoded dark colors
- **Consistent spacing**: use Tailwind scale (1, 1.5, 2, 2.5, 3, 4, 5, 6)
- **Focus states**: `focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)`. ESLint rejects the legacy `focus:ring-*` classes (see DESIGN.md §5)
- **Transitions**: use `--aw-transition-fast` (150ms), `--aw-transition-normal` (300ms)

### 6. Component Props Pattern

Every component MUST follow this pattern:

```typescript
// 1. Props interface with explicit types
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  intent?: 'default' | 'success' | 'error' | 'warning' | 'info';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

// 2. Destructured props with defaults
export function Button({
  variant = 'primary',
  intent = 'default',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  // ... implementation
}
```

### 7. Testing Requirements

After EVERY phase of work:

1. Write/update tests for components changed in that phase
2. Run test suite: `cd app && npm test`
3. Run both type checks: `cd app && npm run typecheck`
4. Run lint: `cd app && npm run lint`
5. Run the production bundles: `cd app && npm run build:app`
6. Run the installer build when packaging changed: `cd app && npm run build`
7. All applicable checks must pass before committing

For desktop-side changes:

1. Run `cd app && npm run typecheck:desktop`
2. Run `cd app && npm run test:desktop`
3. Run `cd app && npm run build:electron`

### 8. Commit Requirements

After EVERY phase:

1. Stage only the changes that belong to the phase
2. **NEVER** stage local working notes, scratch files, or anything under `docs/.scratch/`
3. Commit with a conventional-commit message (`feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`)
4. Verify commit succeeded with `git status`

---

## Design System

### Color Tokens

The palette lives in **DESIGN.md** (front matter and §2): warm paper surfaces in light mode, zinc in dark mode, and one ink-teal accent. The values are the `--aw-*` custom properties in `src/styles/base.css`, mapped to Tailwind colours in the `@theme` block of `src/index.css`. Use the token classes (`bg-primary`, `bg-surface-raised`, `text-text-secondary`, `border-border`, `text-status-error`, …) and never copy hex values. For accent text that must read in both themes, use `text-primary dark:text-primary-light`; `primary-dark` is a fixed deep teal for light surfaces and is not a dark-mode text colour. `app/DESIGN_SYSTEM.md` lists the token families.

### Typography

- **UI**: Inter (`font-sans`) — all body text, labels, headings, inputs
- **Code**: JetBrains Mono (`font-mono`) — code blocks, JSON, URLs
- **Size floor**: 11px. `text-2xs` (11px) → `text-xs` (12px) → `text-sm` (14px) → `text-base` (16px). An arbitrary `text-[Npx]` fails lint. See DESIGN.md §3.

### Button System

| Variant | Description | Usage |
|---------|------------|-------|
| `primary` | Filled with shadow | Main actions, CTAs |
| `secondary` | Outlined with tint | Secondary actions |
| `ghost` | Minimal, hover only | Tertiary actions, icons |

| Intent | Color | Usage |
|--------|-------|-------|
| `default` | Primary (teal) | Standard actions |
| `success` | Green | Create, save, confirm |
| `error` | Red | Delete, cancel, destructive |
| `warning` | Yellow/amber | Caution actions |
| `info` | Blue | Informational actions |

| Size | Usage |
|------|-------|
| `xs` | Icon-only buttons, inline actions |
| `sm` | Small inline buttons, table actions |
| `md` | Standard buttons, form actions |
| `lg` | Large CTA buttons, hero actions |

### Reusable Component API

#### `Button`

```tsx
<Button variant="primary" intent="success" size="md" onClick={handleSave}>
  Save
</Button>
```

#### `IconButton`

```tsx
<IconButton icon={Save} tooltip="Save workflow" onClick={handleSave} />
```

#### `Panel`

```tsx
<Panel title="Variables" icon={Package} collapsible defaultExpanded>
  <PanelTabs tabs={tabs} activeTab={active} onTabChange={setActive} />
  <div>{content}</div>
</Panel>
```

#### `FormField`

```tsx
<FormField label="URL" hint="Supports variables" error={errors.url}>
  <Input type="text" value={url} onChange={setUrl} />
</FormField>
```

#### `Card`

```tsx
<Card title="Configuration" icon={Settings} collapsible>
  <FormField label="Timeout">
    <Input type="number" value={timeout} />
  </FormField>
</Card>
```

---

## Workflow

### Before Starting Any Work

1. Read this file (`apiweave-context.md`) and `AGENTS.md`
2. Read `DESIGN.md` and `app/DESIGN_SYSTEM.md` for design tokens and guidelines
3. Understand the existing codebase structure before making changes

### During Work

1. Follow TypeScript strict mode — no `any`, explicit types everywhere
2. Use reusable components — never duplicate patterns
3. Follow atomic design structure — put components in the right layer
4. Use design tokens — never hardcoded colors
5. Write tests alongside components
6. For desktop-side changes: keep all SQLite access inside `app/core/repositories/`, register new operations through `app/core/ipc/handlers/`, never bypass the IPC handler registry

### After Each Phase

1. Run `cd app && npm run typecheck` — zero type errors required
2. Run `cd app && npm run lint` — zero lint errors required
3. Run `cd app && npm run build:app` — successful renderer and Electron bundles required
4. Run `cd app && npm test` — all tests passing required
5. Commit with a conventional-commit message, leaving out local notes and `docs/.scratch/`

### Lessons Learned

- Tests are part of the strict source tree: no `.js` files under `app/src`, tests included.
- Fallback UI props should preserve the real component contract. Prefer conditional rendering over constructing incomplete placeholder objects for typed domain entities like `Environment`.
- Keep diagnostic logging limited to `console.warn`/`console.error`, or guard verbose logs behind development-only checks.

---

## MCP Architecture

APIWeave exposes a local MCP (Model Context Protocol) server so AI agents on the same machine can drive the desktop app.

### Transport

| Transport | Use Case | Entry Point |
|-----------|----------|-------------|
| **Loopback HTTP** | Local AI agents on the same machine | `app/core/mcp/host.ts` |

The server is bound to `127.0.0.1` only. It is opt-in (a setting in the desktop app) and authenticates with a per-install bearer token written to a file under the user's app data directory. There is no `stdio` transport in the desktop app; loopback HTTP is the single MCP entry point. There is no Streamable HTTP across the network — the desktop app has no exposed ports.

### File Structure

```text
app/core/mcp/
  host.ts              HTTP server bound to 127.0.0.1
  bridge.ts            Maps MCP tool calls to IPC handler invocations
  server.ts            MCP server setup
  token-file.ts        Per-install token file (regenerable from Settings)
  tools.ts             Tool whitelist and annotations
  guide.ts             Server instructions and the bundled authoring guides
  resources.ts         Guide and run-snapshot resources
  prompts.ts           MCP prompts
  run-projection.ts    Secret-safe run results
  error-projection.ts  Error results for agents
  result-encoding.ts   Structured and text tool results
```

### Architecture Rules

- The MCP bridge mounts the same IPC handler registry that the renderer uses. There is one source of truth for server-side operations.
- The MCP bridge MUST NOT call any HTTP endpoint. It calls IPC handlers directly.
- Both the renderer and the MCP bridge go through the same service layer. The MCP bridge never has its own service implementations.
- Secrets are NEVER returned by MCP read tools. Read and export tools redact persisted secrets at the response layer.
- The token file persists per installation and is reused when the bridge is re-enabled, until the user regenerates it from Settings. The token is the only auth surface; requests whose Host is not the loopback listener are refused.

### Testing/Verification Baseline

After MCP changes:

1. Run desktop tests: `cd app && npm run test:desktop`
2. Run type check: `cd app && npm run typecheck:desktop`
3. Run desktop build: `cd app && npm run build:electron`
4. Enable the MCP bridge in the app settings, point an MCP client at the loopback URL, and confirm the tool picker shows the expected tool list.

---

## Tech Stack Reference

- **React** 19.3 — UI framework
- **React Router** 7 — renderer routing
- **TypeScript** 6 — strict mode, no `any`
- **Tailwind CSS** 4.3 — utility-first styling (`@theme` tokens in `src/index.css`)
- **daisyUI** 5.7 — component base classes (used alongside custom atoms)
- **React Flow** 12 (`@xyflow/react`) — workflow canvas
- **Zustand** 5.0 — state management
- **Headless UI** 2.2 — unstyled accessible components (Modal, Popover, Transition)
- **Lucide React** — icon library
- **Vite** 8.3 — renderer build tool
- **xterm.js** 6 (`@xterm/xterm`, with the fit and WebGL addons) — embedded agent terminal
- **node-pty** 1.1 — pseudoterminals for embedded agents, run in the PTY host utility process
- **QuickJS** 0.32 (`quickjs-emscripten-core` with the single-file release variant) — sandbox for workflow scripts and regex matching
- **Sonner** — toast notifications
- **Allotment** — split pane layout
- **Monaco Editor** — JSON/code editor
- **Floating UI** — tooltip positioning (the `Tooltip` atom)
- **Electron** 44 — desktop shell
- **better-sqlite3** 13 — embedded local store
- **libsodium-wrappers** — sealed-box secret encryption
- **esbuild** — main process bundler
- **electron-builder** — installer packaging
- **@modelcontextprotocol/sdk** — local MCP server
- **zod** — runtime schema validation
- **undici** — outbound HTTP for the runner's safe_http
