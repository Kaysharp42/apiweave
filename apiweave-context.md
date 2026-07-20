# APIWeave — Project Context & Agent Rules

> This file MUST be read by every agent before making any changes to the codebase.
> It defines the architecture standards, coding rules, and workflow that ALL agents must follow.

---

## Project Overview

**APIWeave** is a Visual API Test Story Builder — a single-process Electron desktop app for creating, managing, and running API testing workflows visually. It consists of:

- **Renderer**: React + TypeScript + Tailwind CSS + DaisyUI + ReactFlow (workflow canvas)
- **Main process**: Electron + TypeScript + better-sqlite3 (workflow execution, IPC handlers, local store)
- **Local MCP bridge**: loopback HTTP server on `127.0.0.1`, opt-in, exposes the IPC handler registry as a second transport
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
- **ONE type per file**: Every type, interface, or union MUST be in its own file named after the type (e.g., `Workflow.ts`, `ButtonProps.ts`). The `index.ts` barrel export re-exports all types.
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
```
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
  - See `tailwind.config.js` and `src/styles/base.css` for all tokens
- **Dark mode**: always use `dark:` prefix — never separate dark mode files or hardcoded dark colors
- **Consistent spacing**: use Tailwind scale (1, 1.5, 2, 2.5, 3, 4, 5, 6)
- **Focus states**: `focus:outline-none focus:ring-2 focus:ring-primary`
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
1. Stage only source code changes
2. **NEVER** stage these files:
   - `todo.md`
   - `progress/learnings.md`
   - Any file under `progress/` directory
3. Create commit with the phase-specific message from `todo.md`
4. Verify commit succeeded with `git status`

---

## Design System

### Color Tokens (from `tailwind.config.js`)
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `primary` | `#164e63` | `#22d3ee` | Primary actions, active states |
| `surface` | `#f8fafc` | `#111827` | Page background |
| `surface-raised` | `#ffffff` | `#1f2937` | Cards, panels, modals |
| `text-primary` | `#111827` | `#f3f46` | Body text, headings |
| `text-secondary` | `#4b5563` | `#9ca3af` | Labels, descriptions |
| `text-muted` | `#9ca3af` | `#4b5563` | Placeholders, hints |
| `border` | `#cbd5e1` | `#374151` | Default borders |
| `status-success` | `#16a34a` | `#4ade80` | Success state |
| `status-error` | `#dc2626` | `#f87171` | Error state |

### Typography
- **Body**: Open Sans (`font-sans`) — all body text, labels, inputs
- **Display**: Montserrat (`font-display`) — headings, logo, branding
- **Code**: JetBrains Mono (`font-mono`) — code blocks, JSON, URLs

### Button System
| Variant | Description | Usage |
|---------|------------|-------|
| `primary` | Filled with shadow | Main actions, CTAs |
| `secondary` | Outlined with tint | Secondary actions |
| `ghost` | Minimal, hover only | Tertiary actions, icons |

| Intent | Color | Usage |
|--------|-------|-------|
| `default` | Primary (cyan) | Standard actions |
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
1. Read this file (`apiweave-context.md`)
2. Read `todo.md` for current phase and checklist
3. Read `app/DESIGN_SYSTEM.md` for detailed design tokens and guidelines
4. Understand the existing codebase structure before making changes

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
5. Commit with phase-specific message (excluding `todo.md`, `progress/`)

### Phase 10 Lessons Learned
- TypeScript migration is not complete while `.js` tests remain under `app/src`; tests are part of the strict source tree and must be migrated alongside production files.
- Fallback UI props should preserve the real component contract. Prefer conditional rendering over constructing incomplete placeholder objects for typed domain entities like `Environment`.
- Canvas hydration must tolerate both backend workflow payloads (`nodeId`/`edgeId`) and in-memory ReactFlow snapshots (`id`/`data`) when tabs can store either shape.
- Production debug output should be removed during final polish. Keep diagnostic logging limited to `console.warn`/`console.error` or guard verbose logs behind development-only checks.

---

## File Exclusion Rules (Commits)
These files MUST NEVER be included in commits:
- `todo.md` — progress tracking file
- `progress/learnings.md` — learning notes
- Any file under `progress/` directory — work-in-progress notes

---

## MCP Architecture

APIWeave exposes a local MCP (Model Context Protocol) server so AI agents on the same machine can drive the desktop app.

### Transport

| Transport | Use Case | Entry Point |
|-----------|----------|-------------|
| **Loopback HTTP** | Local AI agents on the same machine | `app/core/mcp/host.ts` |

The server is bound to `127.0.0.1` only. It is opt-in (a setting in the desktop app) and authenticates with a static per-install token written to a file under the user's app data directory. There is no `stdio` transport in the desktop app; loopback HTTP is the single MCP entry point. There is no Streamable HTTP across the network — the desktop app has no exposed ports.

### File Structure

```
app/core/mcp/
  host.ts        HTTP server bound to 127.0.0.1
  bridge.ts      Maps MCP tool calls to IPC handler invocations
  server.ts      MCP server setup
  token-file.ts  Static token, written to a per-install file
  tools.ts       Tool inventory
```

### Architecture Rules

- The MCP bridge mounts the same IPC handler registry that the renderer uses. There is one source of truth for server-side operations.
- The MCP bridge MUST NOT call any HTTP endpoint. It calls IPC handlers directly.
- Both the renderer and the MCP bridge go through the same service layer. The MCP bridge never has its own service implementations.
- Secrets are NEVER returned by MCP read tools. Read and export tools redact persisted secrets at the response layer.
- The token file is rewritten on every install. The static token is the only auth surface.

### Testing/Verification Baseline

After MCP changes:
1. Run desktop tests: `cd app && npm run test:desktop`
2. Run type check: `cd app && npm run typecheck:desktop`
3. Run desktop build: `cd app && npm run build:electron`
4. Enable the MCP bridge in the app settings, point an MCP client at the loopback URL, and confirm the tool picker shows the expected tool list.

---

## Tech Stack Reference
- **React** 18.2 — UI framework
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** 3.3 — utility-first styling
- **DaisyUI** 5.5 — component base classes (used alongside custom atoms)
- **ReactFlow** 11.10 — workflow canvas
- **Zustand** 5.0 — state management
- **Headless UI** 2.2 — unstyled accessible components (Modal, Popover, Transition)
- **Lucide React** — icon library
- **Vite** 5.0 — build tool
- **Sonner** — toast notifications
- **Allotment** — split pane layout
- **Monaco Editor** — JSON/code editor
- **Mousetrap** — keyboard shortcuts
- **Tippy.js** — tooltips
- **Axios** — HTTP client
- **Electron** 33 — desktop shell
- **better-sqlite3** 12 — embedded local store
- **libsodium-wrappers** — sealed-box secret encryption
- **esbuild** — main process bundler
- **electron-builder** — installer packaging
- **@modelcontextprotocol/sdk** — local MCP server
- **zod** — runtime schema validation
- **undici** — outbound HTTP for the runner's safe_http
