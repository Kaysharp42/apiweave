# Environment Variables

*Canonical reference for every environment variable APIWeave reads or sets: the desktop app's main process, the host variables it consults, the `apiweave run` CLI, and the variables it hands to the coding agents it launches. Settings that change at runtime live in the SQLite database and are managed through the in-app settings panels, not through the environment.*

## Prerequisites

None. This is a reference doc. If you are setting up APIWeave for the first time, read the [Documentation Hub](../README.md) first.

## Reading Order

Variables are grouped by who reads them. Within each group, the table lists every variable name, whether it is required, the default if you do not set it, and what it controls.

In a packaged app, set a variable on the host before launching the app. In a development run from `app/`, `npm run dev` also reads the ignored `app/.env.local` file and passes its values to the build and to Electron.

## Renderer (Frontend)

There are no renderer environment variables. The renderer always talks to the bundled main process over the typed IPC channel, in development and in packaged builds. The app version shown in the footer is not an environment variable either: `app/vite.config.js` injects it at build time from `app/package.json`.

## Main Process (Desktop)

Variables the Electron main process reads from the host environment.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APIWEAVE_FRONTEND_DIST` | No | `app.getAppPath()/dist/renderer` | Dev runs only: absolute path to the renderer's `dist/` directory, to point the main process at a custom build of the renderer. A packaged build ignores it and always serves the renderer it shipped with. |
| `APIWEAVE_DEV_UPDATES` | No | unset | Set to `1` to rehearse the updater against a local manifest (`app/dev-app-update.yml`) instead of the release channel. Any other value is ignored. See [Release and Updates](release-and-updates.md). |
| `APIWEAVE_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn` or `error`. Any other value falls back to `info`. |
| `APPIMAGE` | No | set by the AppImage runtime | Linux only. Set automatically when the app runs from an AppImage; the updater uses it to replace the AppImage in place, and **Open at login** writes it (rather than the temporary mount path) into the autostart entry. |

Most main-process behavior is not environment-driven: the SQLite database path (`<userData>/apiweave.db`), the secret-store keyfile (`<userData>/keyfile.json`), and the Linux Wayland hint (`ozone-platform-hint=auto`) are fixed by the app rather than read from the environment. There is no `APIWEAVE_DB_PATH` or `APIWEAVE_KEYFILE_PATH` override.

`<userData>` is the OS-standard user data path for the app:

- **Windows**: `%APPDATA%\APIWeave`
- **macOS**: `~/Library/Application Support/APIWeave`
- **Linux**: `~/.config/APIWeave`

## Read From the Host

Standard variables APIWeave consults because they describe the user's machine. You normally do not set them for APIWeave; they are listed so their effect is not a surprise.

| Variable | Platform | What APIWeave does with it |
| --- | --- | --- |
| `XDG_CONFIG_HOME` | Linux | **Open at login** writes its autostart entry to `$XDG_CONFIG_HOME/autostart/apiweave.desktop`, or `~/.config/autostart/apiweave.desktop` when it is unset. |
| `SHELL` | Linux, macOS | At startup the app asks this login shell (falling back to the account's shell from the user database) for its `PATH`, because an app launched from a desktop entry or the Finder does not inherit it. That `PATH` is what agent detection and launching use. Not used on Windows. |
| `TERMINAL` | Linux, macOS | The emulator to prefer when an agent is opened in an external terminal. May be a name or a path. On Linux an emulator APIWeave does not know is tried last. |
| `TERM_PROGRAM` | Linux, macOS, Windows | Set by the terminal that started APIWeave; used to prefer that emulator for external terminals when `TERMINAL` is not set. |
| `PATH`, `PATHEXT`, `COMSPEC` | All | Used to find agent executables, `git`, `gh` and `glab`, and on Windows to run `.cmd` shims through `cmd.exe`. |

## CLI (`apiweave run`)

Variables the headless CLI reads. See [Run APIWeave Tests in CI](../guides/ci.md) for the full CLI reference.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APIWEAVE_SECRET_<NAME>` | For each secret a run references | unset | The value of `{{secrets.<NAME>}}`. Wins over `--secrets-file` and loses to `--secret NAME=value`. A missing secret exits `2` before any request is sent. |
| `HTTPS_PROXY` / `https_proxy` | No | unset | Proxy for every request, http and https, when `--proxy` is not given. Checked first. |
| `HTTP_PROXY` / `http_proxy` | No | unset | Proxy used when neither `--proxy` nor `HTTPS_PROXY` is set. |
| `NO_PROXY` / `no_proxy` | No | unset | Hosts sent directly rather than through the proxy. |
| `NO_COLOR` | No | unset | When set to any value, the console report uses no colour. Colour is also off whenever stdout is not a terminal. |
| `NODE_EXTRA_CA_CERTS` | No | unset | Node's own variable: a PEM file of extra CA certificates, trusted alongside the bundled roots and any `--ca-cert`. |

The desktop app does not read these: its proxy, CA and client-certificate settings live in [Settings → Network](../features/network.md).

## Set for Launched Agents

When you launch a coding agent from APIWeave (see [Coding Agents](../features/coding-agents.md)), the app adds these variables to the agent's environment, on top of the inherited one. The `APIWEAVE_*` identity variables always win over a custom agent definition that tries to set the same name.

| Variable | Set for | Value |
| --- | --- | --- |
| `APIWEAVE_WORKSPACE_ID` | Every agent | The id of the workspace the agent was launched from. |
| `APIWEAVE_WORKFLOW_ID` | An agent launched on a workflow | The workflow's id. |
| `APIWEAVE_PROJECT_ID` | An agent launched on a project | The project's id. |
| `APIWEAVE_MCP_TOKEN` | Codex CLI, while the MCP server is on | The MCP bridge's bearer token. Codex's argv names the variable, so the token never appears on the command line. |
| `GEMINI_CLI_SYSTEM_SETTINGS_PATH` | Gemini CLI, while the MCP server is on | Path to a per-session settings file holding the APIWeave MCP server. |
| `OPENCODE_CONFIG` | OpenCode | Path to a per-session config file holding the APIWeave MCP server and the session briefing. |

The files those variables name are per-session scratch files in the app's user data folder, deleted when the session ends.

## Common Mistakes

A short list of foot-guns we have seen. Each one has tripped up a real user.

### Mistake 1: Copying only the database to a new machine

Secrets do not move between machines. `keyfile.json` is sealed by the operating system keychain of the user who created it, so on another machine (or another OS user) it cannot be opened even when copied, and APIWeave asks at startup whether to quit or to delete the secrets it cannot open. Copy the user data directory, then re-enter the secrets through the write flow. Restoring a backup on the same machine works only when `keyfile.json` comes from the same backup as `apiweave.db`.

## Troubleshooting

- **If development changes do not appear**, stop and restart `npm run dev`. It builds the renderer and Electron once and then launches the app; it does not watch for changes.
- **If the main process refuses to start with a database error**, the user data directory is not writable. Check permissions and free disk space.
- **If an MCP client cannot connect**, enable the bridge in **Settings → MCP Server** and copy the live loopback URL from that page. APIWeave prefers port `47271` and automatically selects a free fallback if that port is occupied.
- **If APIWeave says your stored secrets cannot be decrypted at startup**, `keyfile.json` is missing or the operating system keychain will not open it. Quit, then restore `keyfile.json` from the same backup as the database, or unlock the keychain (on Linux, start GNOME Keyring or KWallet). After moving to a new machine, choose to delete the stored secrets and re-enter them.
- **If an installed agent shows as not installed on Linux or macOS**, the login shell's `PATH` does not include it. Check that `$SHELL -ilc env` (an interactive login shell, which is what APIWeave runs) prints a `PATH` with the agent's folder, then restart APIWeave.

## Related

- [Architecture](architecture.md)
- [Installation](../getting-started/installation.md)
- [Run APIWeave Tests in CI](../guides/ci.md)
- [Coding Agents](../features/coding-agents.md)
- [MCP Integration Guide](../features/mcp-integration.md)
