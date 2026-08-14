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
| `VITE_APP_VERSION` | No | from `app/package.json` `version` | The app version shown in the footer. Injected by Vite at build time (via `define`), with a `"0.0.0"` fallback when the package version cannot be read. |
| `VITE_API_URL` | No | `http://localhost:8000` (dev) | Legacy. The renderer always talks to the bundled main process over the typed IPC channel — in development and in packaged builds — and does not make HTTP calls to a separate backend. This variable is no longer read at runtime; it remains in `app/.env.example` and the `ImportMeta` type for compatibility. |
| `VITE_API_WEAVE_URL` | No | `http://localhost:8000` (dev) | Legacy. Same as `VITE_API_URL`: the renderer uses the typed IPC channel and does not call a separate HTTP backend. No longer read at runtime; it remains only in `app/.env.example`. |

### Example frontend `.env`

```env
VITE_API_URL=http://localhost:8000
VITE_API_WEAVE_URL=http://localhost:8000
```

These values are legacy and are not read at runtime. The renderer always talks to the bundled main process over the typed IPC channel, in both development and packaged builds; there is no separate backend to point at.

## Main Process (Desktop)

Variables the Electron main process reads from the host environment. In a packaged app, defaults are baked in. In a development run from `app/`, you can set these in the shell before `npm run dev` to override the defaults.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APIWEAVE_FRONTEND_DIST` | No | `process.resourcesPath/renderer` (packaged), `app.getAppPath()/dist/renderer` (dev) | Absolute path to the renderer's `dist/` directory. Override to point the main process at a custom build of the renderer. |
| `APIWEAVE_DEV_UPDATES` | No | unset | Set to `1` to rehearse the updater against a local manifest (`app/dev-app-update.yml`) instead of the release channel. |
| `APIWEAVE_CLOUD_ENTRY_URL` | No | baked-in Cloud entry URL | Override the APIWeave Cloud endpoint the sync client talks to. |
| `APPIMAGE` | No | set by AppImage runtime | Linux-only. Set automatically when the app runs from an AppImage; the updater uses it to self-update the AppImage in place. |

Most main-process behavior is not environment-driven: the SQLite database path (`<userData>/apiweave.db`), the secret-store keyfile (`<userData>/keyfile.json`), the log level (`info`), and the Linux Wayland hint (`ozone-platform-hint=auto`) are fixed by the app rather than read from the environment. There is no `APIWEAVE_DB_PATH` or `APIWEAVE_KEYFILE_PATH` override.

`<userData>` is the OS-standard user data path for the app:

- **Windows**: `%APPDATA%\APIWeave`
- **macOS**: `~/Library/Application Support/APIWeave`
- **Linux**: `~/.config/APIWeave`

## Common Mistakes

A short list of foot-guns we have seen. Each one has tripped up a real user.

### Mistake 1: Changing `VITE_API_URL` after the frontend has built

Vite injects these values at build time, then the browser bundle no longer reads `.env`. If you change the value in `app/.env` and forget to rebuild, the running app keeps the old URL. The fix is always `npm run build` after editing `app/.env`.

```bash
cd app
# Edit .env, then rebuild
npm run build:renderer
```

### Mistake 2: Copying only the database to a new machine

The keyfile and the database must travel together. If you copy `apiweave.db` to a new machine and forget `keyfile.json`, the secret store is unreadable. Copy the whole user data directory, or re-enter the secrets through the write flow.

## Troubleshooting

- **If the renderer shows stale build-time configuration**, rebuild the renderer (`npm run build:renderer` from `app/`). The desktop app always loads the built bundle.
- **If the main process refuses to start with a database error**, the user data directory is not writable. Check permissions and free disk space.
- **If an MCP client cannot connect**, enable the bridge in **Settings** and copy the live loopback URL from the **MCP** panel. APIWeave prefers port `47271` and automatically selects a free fallback if that port is occupied.
- **If a stored secret value seems unreadable after moving the database to a new machine**, the keyfile (`keyfile.json`) from the source machine is not on the destination. Copy the keyfile too, or re-enter the secrets through the write flow.

## Related

- [Architecture](architecture.md)
- [Installation](../getting-started/installation.md)
- [MCP Integration Guide](../features/mcp-integration.md)
