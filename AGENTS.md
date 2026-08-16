# APIWeave — OpenCode Agent Instructions

> **Stop and Read**: `apiweave-context.md` is the single source of truth for detailed architecture, design tokens, and UI components. Read it before starting any feature work.

- Do not preserve backward compatibility. Remove obsolete paths instead of
adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current
requirements. Avoid speculative abstractions, configuration, and
indirection.
- Grow the system in layers. Start from the smallest version that works end
to end, and add each new capability on top of a product that already
works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall
complexity or improve reliability. Do not reimplement common
functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own
implementation or adding packages. Do not assume a library lacks a
capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap
that only works for now and is meant to be replaced later.

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
- For day-to-day development, run `npm run dev` from `app/`; this builds both bundles and launches Electron with the renderer embedded behind `app://local/`. No renderer HTTP server is started. Restart the command after source changes.

## Architecture & Code Quirks (Do Not Violate)

### Frontend

- **WorkflowContext is Sacred**: `app/src/contexts/WorkflowContext.tsx` is the single source of truth for canvas state. Bypassing it for variables or settings will cause sync bugs.
- **Auto-Save with explicit flush**: State changes trigger a 700ms debounced auto-save over IPC. A **Save** toolbar button and `Ctrl+S` flush to disk immediately, bypassing the debounce. Do not add any other manual save paths.
- **TypeScript STRICT**: `.ts`/`.tsx` ONLY. `any` is strictly forbidden.
- **ONE Type Per File**: Every interface/type MUST be in its own file under `src/types/` and exported via `index.ts`.
- **UI Reusability**: Never use raw HTML elements with Tailwind classes when a component exists. Always use `Button`, `IconButton`, `Panel`, `FormField`, `Card`, etc. (See `apiweave-context.md`).

### Desktop

- **Single process**: The Electron main process owns everything except the renderer UI. There is no separate backend, worker, or database server. Keep it that way.
- **Repositories only**: All SQLite access goes through `app/core/repositories/`. The IPC handlers, the runner, the MCP bridge, and any other consumer must call repository methods. No raw `better-sqlite3` queries outside `core/db/` and `core/repositories/`.
- **IPC handler registry**: New server-side operations go into `app/core/ipc/handlers/<domain>.ts` and are registered through `app/core/ipc/handlers/index.ts`. The renderer calls them through the typed channel exposed by `app/electron/preload.ts`. Don't add a new `ipcMain.handle(...)` call scattered across the codebase; route through the registry. The exception is the privileged bridges below.
- **MCP bridge is a second transport over the same router**: `app/core/mcp/` exposes the IPC handler registry as a local HTTP server bound to the loopback interface, so a handler on the router is *reachable by any local agent*, not just by the renderer. Which handlers are actually published is an explicit whitelist in `app/core/mcp/tools.ts`, with a test asserting the exclusions stay excluded — a new handler is exposed to agents only once it is added there.
- **Privileged operations bypass the router**: anything a local agent must never be able to invoke — installing an update, spawning a process — is registered with a direct `ipcMain.handle` behind `requireTrustedSender` and exposed through its own preload world (`__APIWEAVE_MCP__`, `__APIWEAVE_UPDATES__`, `__APIWEAVE_AGENTS__`). Off the router there is no path from the MCP bridge to reach it at all, which makes the safety structural rather than dependent on remembering to omit it from the whitelist.
- **No secrets in exports**: `.awecollection` bundles carry references only. Secret values, ciphertext, private keys, and tokens never appear in exports or in any read API.
- **Pseudoterminals run in the PTY host, not in main**: `app/electron/pty_host.ts` is an Electron `utilityProcess` that owns every embedded agent's PTY and nothing else, forked lazily by `app/electron/agent_process_manager.ts`. A native crash there takes down only that process, sessions survive a renderer reload, and terminal output reaches the renderer over a `MessagePort` rather than through main — so throughput never depends on main's event loop. A port is delivered to exactly one holder: render one terminal per session, never two. Both responsive layout branches of `MainLayout` are in the DOM at once, so the branch that mounts the agent panel is chosen in JS from the breakpoint (`useMediaQuery`), not with `hidden`/`md:hidden` — CSS hides the second copy without stopping it taking the port.
- **A live agent is either working or waiting, and only the PTY host can tell**: `status` distinguishes `starting`/`running`/`exited`/`failed` — process facts — and says nothing about whether the agent is producing output or sitting at its prompt. That comes from `agent.activity`, which the host derives from its own data callback (`PTY_IDLE_AFTER_MS`) and reports on the edges only. It is deliberately never persisted: it flips several times a minute, belongs to no column on the session row, and would be a lie the moment the app restarts. `AgentSessionsProvider` holds it in memory as `busySessionIds` and — unlike every other session event — does **not** refresh the list for it. A spinner in the agents UI must be driven by that flag, not by `status`: a badge that animates for every live session animates for agents that are doing nothing, which is where the reader learns to ignore it.
- **A session row is APIWeave's; the conversation is the agent's**: `sessionId` names a row and means nothing to the CLI. `agentSessionRef` is the CLI's *own* id for the conversation, and it is what makes a finished session resumable. **A row is a conversation, not a run**: resuming reuses the row (`AgentRepository.reviveSession` clears the previous run's outcome and moves `startedAt`), because a list of near-identical rows is not something a user can navigate. Three consequences, each of which was a bug first: `AgentEventBroker` clears its terminal flag on `agent.started` or the second run's exit is swallowed as a duplicate; the PTY host `retire`s an entry it is about to replace under the same id, or the old session's port leaks and the terminal reads a dead channel; and the dock keys `AgentTerminal` on `sessionId:startedAt`, or React keeps the old xterm on its closed port. Two capture routes, declared per agent in `shared/agents/builtin-agents.ts`: `assign` mints the id and passes it at launch (`--session-id`), `scan` watches output for a pattern the agent prints. Resume args are spliced immediately after `argv` and before everything else, because for some CLIs resuming is a *subcommand* (`codex resume <id>`) that must be the first word. Every flag in that table is a claim about someone else's CLI: only ship one confirmed against docs or source, and leave `resumeArgs` empty otherwise — an agent that never offers Resume is a smaller loss than an offer that errors when a user is trying to recover lost work.
- **Session metadata is written past the terminal-status guard, and only it**: `recordProcessEvent` and `AgentRepository.updateSession` both refuse to move a row out of `exited`/`failed`. `agent.sessionRef` and `agent.title` are handled *before* that guard, because an agent that mints its own id prints it in the banner it writes as it exits — so the ref for a resumable session almost always arrives after the row is terminal. `AgentEventBroker` likewise drops post-terminal `agent.activity` but must never drop those two. Neither is status, so writing them late cannot resurrect anything.
- **Native addons are prepared by `scripts/rebuild-sqlite.mjs`, not by electron-builder**: `build.npmRebuild` is `false` and `npm run build` runs that script first. electron-builder otherwise rebuilds every native dependency it finds, and node-pty answers a rebuild by deleting its own shipped prebuilds and demanding a C++ toolchain. A new native dependency has to be handled in that script deliberately. Anything with a native binary or a worker resolved from `__dirname` also belongs in `build.asarUnpack` — an addon left inside `app.asar` fails at runtime, and node-pty's Windows conout worker fails by *hanging for ever* rather than by throwing.

## Design Context

- **PRODUCT.md** (root): Strategic product register, users, brand personality, design principles, and anti-references.
- **DESIGN.md** (root): Visual design system — colors, typography, elevation, components, do's and don'ts. Follows Google Stitch DESIGN.md format.
- **app/DESIGN_SYSTEM.md**: Full component inventory, atomic design architecture, DaisyUI themes, CSS custom properties, and the redesign contract.
- **`.impeccable/` directory**: Design tooling config for `/impeccable` commands.

## MCP Tools (codebase-memory-mcp)

- **Use `codebase-memory-mcp` tools** for codebase queries BEFORE falling back to grep/read — `get_architecture`, `search_graph`, `trace_path`, `search_code`, `detect_changes`. Avoid file-by-file exploration when the graph already has the answer.

## Commits & Work Tracking

- Commit messages follow conventional-commit style (`feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`), as used throughout the git history.
- **NEVER stage or commit** local working notes, scratch files, or any file under `docs/.scratch/`.

## graphify

This project keeps a knowledge graph at graphify-out/ (chunk, AST, and semantic caches) with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, run `graphify query "<question>"` when a queryable graph is available. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than a full report or raw grep output.
- Dirty or intermediate graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
