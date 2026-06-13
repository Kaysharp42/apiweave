# Pinned Facts (for docs-1.0-cleanup)

<!-- INTERNAL: scratch file. Not user-facing. Pin counts from source code at write time. -->

Generated: 2026-06-13

## 1. MCP Tools

- **Count**: 56 (`server.tool(` decorator calls across `backend/app/mcp/`)
- **Per-file breakdown**: server.py=1, collection_runs.py=3, collections.py=11, environments.py=9, imports.py=6, runs.py=7, secrets.py=2, webhooks.py=7, workflows.py=10
- **Source command**: `Select-String -Path "backend/app/mcp/**/*.py" -Pattern 'server\.tool\(' -Recurse` (PowerShell equivalent of `grep -rnE 'server\.tool\(' backend/app/mcp/`)
- **Used by**: T13 (features/mcp-integration.md)
- **Note**: The original grep pattern `@(mcp|server)\.tool` was incorrect — tools use `server.tool(` as a function-based registration (FastMCP pattern), not a decorator with `@`. Only `server.py` line 21 uses `@mcp_server.tool()`. Total 56 matches the old docs/MCP.md claim of "56 tools" but the section-header sum of 53 was wrong. Use 56 as authoritative.
- **Anomaly**: No BLOCKER — count is healthy and non-zero.

## 2. Dynamic Functions

- **Count**: 15 (13 dynamic utility functions + 2 helper/meta functions)
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
- **Source command**: `Select-String -Path "backend/app/runner/dynamic_functions.py" -Pattern '^\s+def '` (PowerShell equivalent of `grep -E '^\s+def '`)
- **Used by**: T16 (reference/dynamic-functions.md)
- **Anomaly**: `apiweave-context.md` line 296-307 mentions "13 functions". The actual count is 15, including 13 dynamic utility functions plus 2 internal helpers (`get_function`, `get_all_functions`). Not a BLOCKER but T16 should document this distinction.

## 3. Backend Env Vars

- **Count**: 42
- **Names**: `DEBUG`, `APP_ENV`, `BASE_URL`, `FRONTEND_URL`, `MONGODB_URL`, `MONGODB_DB_NAME`, `ALLOWED_ORIGINS`, `TRUSTED_HOSTS`, `PUBLIC_BASE_URL`, `SECRET_KEY`, `SESSION_SECRET_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_MAX_IDLE_MINUTES`, `SESSION_MAX_ABSOLUTE_MINUTES`, `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_SAMESITE`, `CSRF_ENABLED`, `WEBHOOK_REQUIRE_HMAC`, `APPROVED_DOMAINS_ENABLED`, `APPROVED_DOMAINS`, `SETUP_MODE_ENABLED`, `BLOCK_PRIVATE_NETWORKS`, `MAX_WEBHOOK_BODY_SIZE`, `UPLOADS_BASE_DIR`, `RATE_LIMITER_BACKEND`, `MCP_ENABLED`, `MCP_HTTP_ENABLED`, `MCP_API_KEY`, `MCP_ALLOWED_ORIGINS`, `MCP_REQUIRE_API_KEY`, `MCP_ALLOW_SECRET_WRITES`, `WORKER_POLL_INTERVAL`, `WORKER_MAX_RETRIES`, `ARTIFACTS_PATH`
- **Source command**: `Select-String -Path "backend/.env.example" -Pattern '^[A-Z_]+=' | ForEach-Object { $_.Line.Split('=')[0] }`
- **Used by**: T17 (reference/environment-variables.md)
- **Note**: T17 should ALSO cross-check `backend/app/config.py` for vars not in .env.example. No BLOCKER.

## 4. Frontend Env Vars

- **Count**: 2
- **Names**: `VITE_API_URL`, `VITE_API_WEAVE_URL`
- **Source command**: `Select-String -Path "frontend/.env.example" -Pattern '^[A-Z_]+=' | ForEach-Object { $_.Line.Split('=')[0] }`
- **Used by**: T17 (reference/environment-variables.md)
- **Anomaly**: Only 2 frontend env vars. No BLOCKER.

## 5. Node Types

- **Count**: 6 (TSX component files + 1 index.ts barrel export)
- **Component files**: `AssertionNode.tsx`, `DelayNode.tsx`, `EndNode.tsx`, `HTTPRequestNode.tsx`, `MergeNode.tsx`, `StartNode.tsx`
- **Also present**: `index.ts` (barrel export, not a node component)
- **Source command**: `Get-ChildItem -LiteralPath "frontend/src/components/nodes" -Filter "*.tsx" -File`
- **Used by**: T8 (features/workflows-and-nodes.md)
- **Expected**: 6 (HTTP Request, Assertion, Delay, Merge, Start, End) — matches. No BLOCKER.
