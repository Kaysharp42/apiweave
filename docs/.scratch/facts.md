# Pinned Facts (for docs cleanup)

<!-- INTERNAL: scratch file. Not user-facing. Pin counts from source code at write time. -->

Generated: 2026-06-13. Updated 2026-07-18 for the local-first Electron architecture.

> The earlier Python/FastAPI/MongoDB backend was retired. The desktop app is now
> a single Electron process. Sections below reflect the current source paths.

## 1. MCP Tools

- **Source**: the local MCP bridge in `desktop/core/mcp/` exposes the IPC
  handler registry as a second transport. There is no `backend/app/mcp/` tree.
- **Used by**: features/mcp-integration.md.
- **Note**: the old "56 tools" count came from the removed FastMCP backend and
  no longer applies. Count tools by enumerating the registered IPC handlers the
  bridge exposes; see `desktop/core/ipc/handlers/index.ts`.

## 2. Dynamic Functions

- **Count**: 15 (13 dynamic utility functions + 2 helper/meta functions).
- **Names**:
  - `randomString(length: int = 10) -> str`
  - `randomNumber(size: int = 6) -> str`
  - `randomEmail() -> str`
  - `uuid() -> str`
  - `timestamp() -> str`
  - `iso_timestamp() -> str`
  - `date(format: str = "%Y-%m-%d") -> str`
  - `futureDate(days: int = 1, format: str = "%Y-%m-%d") -> str`
  - `pastDate(days: int = 1, format: str = "%Y-%m-%d") -> str`
  - `randomChoice(options: str) -> str`
  - `randomAlpha(length: int = 10) -> str`
  - `randomNumeric(length: int = 10) -> str`
  - `randomHex(length: int = 16) -> str`
  - `get_function(name: str)` — meta/helper
  - `get_all_functions() -> Dict[str, str]` — meta/helper
- **Source**: `desktop/core/runner/dynamic_functions.ts`.
- **Used by**: reference/dynamic-functions.md.
- **Note**: 13 dynamic utility functions plus 2 internal helpers
  (`get_function`, `get_all_functions`). reference/dynamic-functions.md already
  reconciles the 13-vs-15 distinction.

## 3. Main-process env vars

- **Source**: `docs/reference/environment-variables.md` (Main Process table).
- **Note**: The retired backend's env vars (`MONGODB_URL`, `SECRET_KEY`,
  `SESSION_SECRET_KEY`, `GITHUB_CLIENT_ID`, `WEBHOOK_REQUIRE_HMAC`,
  `MCP_API_KEY`, `MCP_ALLOW_SECRET_WRITES`, `WORKER_POLL_INTERVAL`,
  `WORKER_MAX_RETRIES`, `SETUP_MODE_ENABLED`, `ARTIFACTS_PATH`, etc.) are gone.
  The current main process reads a small set of `APIWEAVE_*` and `OZONE_*`
  variables from the host environment; see the reference doc.

## 4. Renderer env vars

- **Count**: 2 (legacy, not read at runtime).
- **Names**: `VITE_API_URL`, `VITE_API_WEAVE_URL`.
- **Source**: `frontend/.env.example` and the `ImportMeta` type in
  `frontend/src/utils/apiweaveClient.ts`.
- **Used by**: reference/environment-variables.md.
- **Note**: the renderer always talks to the bundled main process over the
  typed IPC channel and does not call a separate HTTP backend. These variables
  are not read at runtime; kept for compatibility.

## 5. Node Types

- **Count**: 6 (TSX component files + 1 index.ts barrel export).
- **Component files**: `AssertionNode.tsx`, `DelayNode.tsx`, `EndNode.tsx`,
  `HTTPRequestNode.tsx`, `MergeNode.tsx`, `StartNode.tsx`.
- **Also present**: `index.ts` (barrel export, not a node component).
- **Source**: `frontend/src/components/nodes/`.
- **Used by**: features/workflows-and-nodes.md.
- **Expected**: 6 (HTTP Request, Assertion, Delay, Merge, Start, End) — matches.