# APIWeave — OpenCode Agent Instructions

> **Stop and Read**: `apiweave-context.md` is the single source of truth for detailed architecture, design tokens, and UI components. Read it before starting any feature work.

## What This Repo Is Now

APIWeave is a local-first Electron desktop app. The Python backend, MongoDB, separate worker, FastAPI, Beanie, Motor, and Docker Compose stack are gone. The whole product is one process: Electron's main process runs the workflow executor, the IPC handler registry, the SQLite store, and the local MCP bridge; the renderer is the ReactFlow canvas. See [README.md](README.md) for the architecture summary and [docs/reference/architecture.md](docs/reference/architecture.md) for the moving parts.

## Critical Development Commands

Run these from the single `app/` package after every phase:

```bash
cd app
npm test                 # Renderer + desktop + shared unit tests
npm run typecheck        # Renderer and desktop TypeScript configs
npm run lint             # Renderer, desktop, and shared linting
npm run build:app        # Build renderer and Electron bundles
npm run build            # Build the installable desktop package
```

### Dev Shell

- `scripts/setup.sh` (Linux/macOS) / `scripts/setup.ps1` (Windows) — install the single dependency graph in `app/`.
- `scripts/start.sh` / `scripts/start.ps1` — run the desktop app in dev.
- `scripts/build.sh` / `scripts/build.ps1` — build the desktop installer.
- `scripts/desktop.ps1 build` (Windows) / `scripts/desktop.sh build` (Linux/macOS) — build the desktop installer.
- For day-to-day development, run `npm run dev` from `app/`; this bundles the main process, starts Vite, and launches Electron pointed at the dev renderer. Renderer changes hot reload; restart the command after main-process changes.

## Architecture & Code Quirks (Do Not Violate)

### Frontend

- **WorkflowContext is Sacred**: `app/src/contexts/WorkflowContext.tsx` is the single source of truth for canvas state. Bypassing it for variables or settings will cause sync bugs.
- **Auto-Save Only**: State changes trigger a 700ms debounced auto-save over IPC. NEVER implement manual "Save" buttons.
- **TypeScript STRICT**: `.ts`/`.tsx` ONLY. `any` is strictly forbidden.
- **ONE Type Per File**: Every interface/type MUST be in its own file under `src/types/` and exported via `index.ts`.
- **UI Reusability**: Never use raw HTML elements with Tailwind classes when a component exists. Always use `Button`, `IconButton`, `Panel`, `FormField`, `Card`, etc. (See `apiweave-context.md`).

### Desktop

- **Single process**: The Electron main process owns everything except the renderer UI. There is no separate backend, worker, or database server. Keep it that way.
- **Repositories only**: All SQLite access goes through `app/core/repositories/`. The IPC handlers, the runner, the MCP bridge, and any other consumer must call repository methods. No raw `better-sqlite3` queries outside `core/db/` and `core/repositories/`.
- **IPC handler registry**: New server-side operations go into `app/core/ipc/handlers/<domain>.ts` and are registered through `app/core/ipc/handlers/index.ts`. The renderer calls them through the typed channel exposed by `app/electron/preload.ts`. Don't add a new `ipcMain.handle(...)` call scattered across the codebase; route through the registry.
- **MCP bridge uses the same handlers**: `app/core/mcp/` exposes the IPC handler registry as a local HTTP server bound to the loopback interface. Adding a new IPC handler is the only step needed to expose it to local agents — do not maintain a parallel MCP handler list.
- **No secrets in exports**: `.awecollection` bundles carry references only. Secret values, ciphertext, private keys, and tokens never appear in exports or in any read API.

## Design Context

- **PRODUCT.md** (root): Strategic product register, users, brand personality, design principles, and anti-references.
- **DESIGN.md** (root): Visual design system — colors, typography, elevation, components, do's and don'ts. Follows Google Stitch DESIGN.md format.
- **app/DESIGN_SYSTEM.md**: Full component inventory, atomic design architecture, DaisyUI themes, CSS custom properties, and the redesign contract.
- **`.impeccable/` directory**: Design tooling config for `/impeccable` commands.

## MCP Tools (codebase-memory-mcp)

- **Use `codebase-memory-mcp` tools** for codebase queries BEFORE falling back to grep/read — `get_architecture`, `search_graph`, `trace_path`, `search_code`, `detect_changes`. Avoid file-by-file exploration when the graph already has the answer.

## Commits & Work Tracking

- Check `todo.md` for current phase tasks and the required commit message format.
- **NEVER stage or commit**: `todo.md`, `progress/learnings.md`, or any file in the `progress/` directory.
