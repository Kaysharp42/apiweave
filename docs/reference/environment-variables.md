# Environment Variables

*Canonical reference for every environment variable read by the APIWeave desktop app. The desktop app is a single Electron process: the renderer reads `VITE_*` variables at build time, and the main process reads its own configuration from the OS environment. For local development, `app/.env.local` supplies machine-specific main-process overrides; settings that change at runtime live in the SQLite database and are managed through the in-app settings panel.*

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
There are no renderer environment variables. The renderer always talks to the bundled main process over the typed IPC channel, in development and in packaged builds.

## Main Process (Desktop)

Variables the Electron main process reads from the host environment. In a packaged app, defaults are baked in. In a development run from `app/`, `npm run dev` reads ignored `app/.env.local` values and passes them to Electron.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APIWEAVE_FRONTEND_DIST` | No | `process.resourcesPath/renderer` (packaged), `app.getAppPath()/dist/renderer` (dev) | Absolute path to the renderer's `dist/` directory. Override to point the main process at a custom build of the renderer. |
| `APIWEAVE_DEV_UPDATES` | No | unset | Set to `1` to rehearse the updater against a local manifest (`app/dev-app-update.yml`) instead of the release channel. |
| `APIWEAVE_CLOUD_ENTRY_URL` | No | baked-in Cloud entry URL | Override the APIWeave Cloud entry URL. The desktop fetches this environment's configuration, which supplies the matching web (`https://dev.apiweave.app`), API (`https://api-dev.apiweave.app`), and auth (`https://auth-dev.apiweave.app`) URLs. |
| `APPIMAGE` | No | set by AppImage runtime | Linux-only. Set automatically when the app runs from an AppImage; the updater uses it to self-update the AppImage in place. |

Most main-process behavior is not environment-driven: the SQLite database path (`<userData>/apiweave.db`), the secret-store keyfile (`<userData>/keyfile.json`), the log level (`info`), and the Linux Wayland hint (`ozone-platform-hint=auto`) are fixed by the app rather than read from the environment. There is no `APIWEAVE_DB_PATH` or `APIWEAVE_KEYFILE_PATH` override.

`<userData>` is the OS-standard user data path for the app:

- **Windows**: `%APPDATA%\APIWeave`
- **macOS**: `~/Library/Application Support/APIWeave`
- **Linux**: `~/.config/APIWeave`

## Common Mistakes

A short list of foot-guns we have seen. Each one has tripped up a real user.

### Mistake 1: Putting the API or auth URL in `.env.local`

Set only the cloud entry URL. The desktop fetches the environment configuration from it and validates that its web, API, and auth endpoints belong together. For the development environment, create `app/.env.local` from `app/.env.example`; it is ignored by Git.

### Mistake 2: Copying only the database to a new machine

The keyfile and the database must travel together. If you copy `apiweave.db` to a new machine and forget `keyfile.json`, the secret store is unreadable. Copy the whole user data directory, or re-enter the secrets through the write flow.

## Troubleshooting

- **If development changes do not appear**, stop and restart `npm run dev`. The Vite renderer reloads browser changes, while Electron main-process changes require a restart.
- **If the main process refuses to start with a database error**, the user data directory is not writable. Check permissions and free disk space.
- **If an MCP client cannot connect**, enable the bridge in **Settings** and copy the live loopback URL from the **MCP** panel. APIWeave prefers port `47271` and automatically selects a free fallback if that port is occupied.
- **If a stored secret value seems unreadable after moving the database to a new machine**, the keyfile (`keyfile.json`) from the source machine is not on the destination. Copy the keyfile too, or re-enter the secrets through the write flow.

## Related

- [Architecture](architecture.md)
- [Installation](../getting-started/installation.md)
- [MCP Integration Guide](../features/mcp-integration.md)
