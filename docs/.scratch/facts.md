# Pinned Facts (for docs cleanup)

<!-- INTERNAL: scratch file. Not user-facing. Pin counts from source code at write time. -->

Generated: 2026-06-13. Updated 2026-08-14 for the 0.7.8 surface.

> The earlier Python/FastAPI/MongoDB backend was retired. The desktop app is now
> a single Electron process. Sections below reflect the current source paths.

## 1. MCP Tools

- **Source**: the local MCP bridge in `app/core/mcp/` exposes the IPC
  handler registry as a second transport. There is no `backend/app/mcp/` tree.
- **Used by**: features/mcp-integration.md.
- **Count**: 50 (49 whitelisted domain tools plus `server_info`).
- **Note**: the old "56 tools" count came from the removed FastMCP backend and
  no longer applies. Count tools from `MCP_TOOLS` in `app/core/mcp/tools.ts`.

## 2. Dynamic Functions

- **Count**: 13 public functions.
- **Names**: `randomString`, `randomAlpha`, `randomNumeric`, `randomHex`,
  `randomEmail`, `randomNumber`, `uuid`, `timestamp`, `iso_timestamp`, `date`,
  `futureDate`, `pastDate`, `randomChoice`.
- **Source**: `app/core/runner/dynamic_functions.ts`.
- **Used by**: reference/dynamic-functions.md.
- **Note**: the resolver class has internal `getFunction` / `getAllFunctions`
  lookup methods that are not placeholder-callable and not public API.

## 3. Main-process env vars

- **Source**: `docs/reference/environment-variables.md` (Main Process table).
- **Note**: the retired backend's env vars (`MONGODB_URL`, `SECRET_KEY`,
  `SESSION_SECRET_KEY`, `GITHUB_CLIENT_ID`, `WEBHOOK_REQUIRE_HMAC`,
  `MCP_API_KEY`, `MCP_ALLOW_SECRET_WRITES`, `WORKER_POLL_INTERVAL`,
  `WORKER_MAX_RETRIES`, `SETUP_MODE_ENABLED`, `ARTIFACTS_PATH`, etc.) are gone.
  The current main process reads `APIWEAVE_FRONTEND_DIST`, `APIWEAVE_DEV_UPDATES`,
  `APIWEAVE_CLOUD_ENTRY_URL`, and `APPIMAGE`; see the reference doc.

## 4. Renderer env vars

- **Runtime read**: 1 — `VITE_APP_VERSION` (build-time, from `app/package.json`).
- **Legacy, not read at runtime**: `VITE_API_URL`, `VITE_API_WEAVE_URL`.
- **Source**: `app/.env.example` and the `ImportMeta` type in
  `app/src/utils/apiweaveClient.ts`.
- **Used by**: reference/environment-variables.md.
- **Note**: the renderer always talks to the bundled main process over the
  typed IPC channel and does not call a separate HTTP backend.

## 5. Node Types

- **Count**: 7 node types (6 node components plus the Call Workflow node).
- **Component files**: `AssertionNode.tsx`, `DelayNode.tsx`, `EndNode.tsx`,
  `HTTPRequestNode.tsx`, `MergeNode.tsx`, `StartNode.tsx`; Call Workflow uses
  node `type: "workflow"` in the schema.
- **Source**: `app/src/components/nodes/`, `app/shared/zod-schemas/`.
- **Used by**: features/workflows-and-nodes.md.
