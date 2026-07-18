# Environment Variables

*Canonical reference for every environment variable read by the APIWeave desktop app. The desktop app is a single Electron process: the renderer reads `VITE_*` variables at build time, and the main process reads its own configuration from the OS environment. There is no `.env` file inside the desktop app; settings that change at runtime live in the SQLite database and are managed through the in-app settings panel.*

## Prerequisites

None. This is a reference doc. If you are setting up APIWeave for the first time, read the [Documentation Hub](../README.md) first.

## Reading Order

Variables are grouped by feature. Within each group, the table lists every variable name, whether it is required, the default if you do not set it, and what it controls. Frontend variables must start with `VITE_` because Vite only exposes that prefix to the browser bundle.

The main process reads a small set of OS environment variables for development overrides. In a packaged app, the defaults are baked into the build; you can override them by setting the variable on the host before launching the app.

## Renderer (Frontend)

Variables Vite injects into the browser bundle. They are baked in at build time, so changing them requires rebuilding the frontend. The `VITE_` prefix is required; Vite refuses to expose any other variable name to the client.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | `http://localhost:8000` (dev) | Legacy. The renderer always talks to the bundled main process over the typed IPC channel — in development and in packaged builds — and does not make HTTP calls to a separate backend. This variable is no longer read at runtime; it remains in `frontend/.env.example` and the `ImportMeta` type for compatibility. |
| `VITE_API_WEAVE_URL` | No | `http://localhost:8000` (dev) | Legacy. Same as `VITE_API_URL`: the renderer uses the typed IPC channel and does not call a separate HTTP backend. No longer read at runtime. |

### Example frontend `.env`

```env
VITE_API_URL=http://localhost:8000
VITE_API_WEAVE_URL=http://localhost:8000
```

These values are legacy and are not read at runtime. The renderer always talks to the bundled main process over the typed IPC channel, in both development and packaged builds; there is no separate backend to point at.

## Main Process (Desktop)

Variables the Electron main process reads from the host environment. In a packaged app, defaults are baked in. In a development run from `desktop/`, you can set these in the shell before `npm run dev:electron` to override the defaults.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APIWEAVE_FRONTEND_DIST` | No | resolved from `app.getAppPath()` | Absolute path to the renderer's `dist/` directory. Override to point the main process at a custom build of the renderer. |
| `APIWEAVE_MCP_PORT` | No | first free loopback port | Port the local MCP bridge binds to. Override to pin a specific port. The bridge is opt-in; this variable is only consulted when the bridge is enabled. |
| `APIWEAVE_MCP_DISABLE` | No | unset | Set to `1` or `true` to prevent the MCP bridge from starting, even if it is enabled in the app settings. Useful for scripted runs and CI. |
| `APIWEAVE_LOG_LEVEL` | No | `info` | Main process log level. One of `debug`, `info`, `warn`, `error`. |
| `APIWEAVE_DB_PATH` | No | `<userData>/apiweave.db` | Override the SQLite database path. Use a different file to run a second instance against an isolated database. |
| `APIWEAVE_KEYFILE_PATH` | No | `<userData>/keyfile` | Override the secret store keyfile path. Use the same override as `APIWEAVE_DB_PATH` to keep the keyfile and the database together. |
| `APIWEAVE_DISABLE_GPU` | No | unset | Set to `1` or `true` to force the software rasterizer. Useful on machines whose GPU driver is incompatible with the renderer's WebGL canvas. |
| `OZONE_PLATFORM_HINT` | No | `auto` | Linux-only. Hint for the Wayland/X11 selection. Defaults to `auto`, which lets Electron pick. Set to `wayland` or `x11` to force a specific backend. |

`<userData>` is the OS-standard user data path for the app:

- **Windows**: `%APPDATA%\APIWeave`
- **macOS**: `~/Library/Application Support/APIWeave`
- **Linux**: `~/.config/APIWeave`

## Common Mistakes

A short list of foot-guns we have seen. Each one has tripped up a real user.

### Mistake 1: Changing `VITE_API_URL` after the frontend has built

Vite injects these values at build time, then the browser bundle no longer reads `.env`. If you change the value in `frontend/.env` and forget to rebuild, the running app keeps the old URL. The fix is always `npm run build` after editing `frontend/.env`.

```bash
cd frontend
# Edit .env, then rebuild
npm run build
```

### Mistake 2: Pointing `APIWEAVE_DB_PATH` at a read-only location

The main process needs write access to the database file. The default `<userData>` location is writable. If you override `APIWEAVE_DB_PATH`, make sure the directory exists and is writable by the user running the app.

### Mistake 3: Forgetting to set `APIWEAVE_KEYFILE_PATH` alongside `APIWEAVE_DB_PATH`

The keyfile and the database must travel together. If you copy the database to a new machine and forget the keyfile, the secret store is unreadable. Override both variables in lockstep, or copy the whole user data directory.

### Mistake 4: Setting `APIWEAVE_MCP_PORT` to a port the OS already has bound

The bridge binds only to `127.0.0.1`, but the port still has to be free. If the override collides with another process, the bridge fails to start. The **MCP** panel in the app shows the actual port; check it after launch.

## Troubleshooting

- **If the renderer shows a stale URL after editing `frontend/.env`**, rebuild the frontend (`npm run build` from `frontend/`). The Vite dev server picks up changes; the built bundle does not.
- **If the main process refuses to start with a database error**, the directory pointed at by `APIWEAVE_DB_PATH` is not writable. Check permissions and free disk space.
- **If the MCP bridge fails to bind**, the port in `APIWEAVE_MCP_PORT` is in use, or the bridge was disabled in **Settings**. Re-enable the bridge in **Settings**, change the port, or set `APIWEAVE_MCP_DISABLE=1` to suppress the bridge entirely.
- **If a stored secret value seems unreadable after moving the database to a new machine**, the keyfile from the source machine is not on the destination. Copy the keyfile too, or re-enter the secrets through the write flow.

## Related

- [Architecture](architecture.md)
- [Installation](../getting-started/installation.md)
- [MCP Integration Guide](../features/mcp-integration.md)
