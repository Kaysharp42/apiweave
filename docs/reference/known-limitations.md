# Known Limitations

*What APIWeave 1.0 does not do, and the platform, network, sync and security
boundaries to plan around. This page describes the 1.0 release line; a later 1.x
release may remove a limitation, but the compatibility policy does not require
it.*

## Table of Contents

- [Platform Support](#platform-support)
- [Signing and Updates](#signing-and-updates)
- [Git Sync](#git-sync)
- [Imports](#imports)
- [Network](#network)
- [Execution](#execution)
- [MCP and Agents](#mcp-and-agents)
- [Secrets and Local Data](#secrets-and-local-data)

## Platform Support

| Platform | What 1.0 supports |
| --- | --- |
| Windows | Windows 10 or 11, x64. There is no 32-bit or Windows on Arm build. |
| macOS | macOS 13 Ventura or newer, on Intel and Apple Silicon. Electron 44 does not run on macOS 11 or 12. |
| Linux | x86_64 with glibc 2.34 or newer (Ubuntu 22.04+, Debian 12+, Fedora 35+). There is no Linux arm64 build. |
| CLI | Node.js 22.12 or newer. The `@apiweave/cli` tarball runs without Electron and without an APIWeave data folder. |
| MCP launcher | Node.js 20 or newer on the `PATH` your MCP client runs with. Only the stdio launcher needs it; the direct HTTP config does not. |
| Source builds | Node.js 22.12 or newer and npm. On Linux, `node-pty` builds a native addon, so a C++ toolchain is needed (`build-essential` on Debian/Ubuntu, or `make`, `python3` and `g++`/`clang++`). The prebuilt installers do not need it. |

The Linux AppImage needs FUSE 2, or `--appimage-extract-and-run` where FUSE is
unavailable. On Arch, the `.pacman` package has no FUSE requirement and is the
recommended artifact.

## Signing and Updates

- **Code signing is opt-in.** A release is signed only when the project's
  certificate secrets are configured: `CSC_LINK` and `CSC_KEY_PASSWORD` for
  macOS, the three `APPLE_*` secrets for notarization, and `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD` for Windows. A release built without them still
  installs, but Windows SmartScreen may warn and macOS Gatekeeper blocks the
  first launch until the app is opened from the context menu or the quarantine
  flag is cleared.
- **macOS self-update requires a Developer ID signature.** A signed and
  notarized build downloads and stages its own update. An unsigned or
  ad-hoc-signed build falls back to the notice-only path, because Squirrel.Mac
  cannot install into an unsigned bundle.
- **Windows and the Linux AppImage self-install.** The `.deb`, `.rpm` and
  `.pacman` packages are notice-only: the operating system's package manager
  owns those installs, so the app links to the release page instead of replacing
  them.
- **`version.json` is not signed.** It only carries the version and tag for the
  notice shown on platforms that cannot self-update; it never drives an
  install.
- **There is no update channel split.** Prereleases are excluded from
  `/releases/latest`, so they are invisible to the updater rather than routed to
  a beta channel. There is no stable/beta switch in the app.
- **A client never downgrades.** Moving the release permalink back stops new
  offers, but a machine already on a bad version stays there until a higher
  version is published. The fix is always to ship forward.
- **Update signatures are mandatory.** Every install trusts the Ed25519 public
  key compiled into it. A local or development build that still carries the
  placeholder key refuses every update, and an update whose per-file signature
  does not match is never installed.

The default policy is **Notify me**. **Automatic** is offered only where the
platform can self-install.

## Git Sync

- **One branch per workspace at a time.** A workspace tracks one branch of one
  remote. Choose an existing branch when connecting or opening from git, and use
  **Switch branch…** later. Creating branches, opening pull requests and
  reviewing them happen in your git host, not in APIWeave.
- **Switching branches refuses to lose work.** A switch is refused while the
  branch being left has unpushed commits, while a merge is waiting, when the
  target branch already exists locally with unpushed commits of its own, or when
  the target holds another workspace.
- **Local version history is not git history.** A workflow's version history
  stays in the local database. The git repository holds the workspace's current
  records and their commits, not the app's revision snapshots.
- **Only some data belongs in the repository.** It holds the workspace,
  projects, workflows, workspace-scoped environments and node presets. It never
  holds secret values, ciphertext, keys, the local list of stored secret names,
  run history, agent sessions, workflow revisions or user-scoped environments.
- **One remote per workspace, and only committed changes travel.** Auto mode
  commits about 30 seconds after the last edit; manual mode commits only on
  **Sync now** / **Commit now**. A machine that has not pushed has not shared
  the change.
- **Git must be installed.** `gh` and `glab` are optional, and a GitLab sign-in
  needs GitLab 17.9 or later plus a `glab` whose account output APIWeave can
  read.
- **One GitLab account per host.** `glab` keeps a single signed-in account for
  each GitLab host, so APIWeave can use only that one there. Signing in to a
  second account on the same host replaces the first in `glab`, and a workspace
  set to sync as the earlier account reports it as unavailable until you sign
  in as it again. GitHub accounts are not limited this way.
- **Repository and owner lists stop at 100.** When you connect a remote or open
  from git, the list shows at most 100 repositories for each GitHub owner (your
  account and each organization) and 100 in all on GitLab, and the owners
  offered for a new repository are your account plus your first 100 GitHub
  organizations or GitLab groups. A list that reaches the cap says so. Use
  **Use a URL instead** for a repository that is not listed.
- **The clone is APIWeave's.** The repository at `<userData>/git/<workspace id>`
  is the app's working copy. Do not edit or commit in it by hand, and set its
  remote through **Connect to remote** / **Disconnect**.
- **The format moves forward only.** Version 2 is written; version 1 is read and
  upgraded on the next commit; a repository written by a newer APIWeave is
  refused with a message to update.

## Imports

- **Postman Collection v2.1 only.** Collection v1 and v2.0 files are refused
  with a request to re-export. A Postman environment export is optional.
- **Some Postman auth is not converted.** Bearer, Basic, API key and OAuth 2.0
  client credentials or authorization code with PKCE import. Digest, Hawk, AWS
  Signature, NTLM, Akamai, JWT, OAuth password and OAuth implicit requests are
  imported without auth, with a warning.
- **Postman scripts are not executed.** Common test patterns (status checks and
  simple response-value extraction) are converted. Pre-request scripts and any
  other test script are kept word for word as notes; collection-level and
  folder-level scripts are kept in the project or workflow description. Port
  them to the request's **Scripts** tab by hand.
- **Variables do not pass between imported workflows.** An extracted variable
  lives in the workflow that extracted it. Keep a login and its dependent
  requests in one folder/workflow, or connect them with **Call Workflow**.
- **HAR import is linear.** The import dialog offers only the linear mode it
  performs: recorded requests become one start-to-end chain. There is no
  parallel HAR import.
- **OpenAPI 3.0/3.1 and Swagger 2.0 only.** Swagger 1.0 is not supported. A
  `$ref` to another file is not fetched, and a converted response schema larger
  than 256 KB is not attached.
- **cURL commands become nodes, not a workflow.** Pasting cURL commands in the
  **Add Nodes** panel parses them into request nodes; it does not create a
  workflow.

## Network

- **HTTP and HTTPS proxies only.** Every request is tunnelled through the proxy
  with `CONNECT`; proxy credentials are sent as Basic `Proxy-Authorization`.
  SOCKS proxies, and NTLM or Kerberos proxy authentication, are not supported.
- **The desktop app ignores proxy environment variables.** `HTTP_PROXY`,
  `HTTPS_PROXY` and `NO_PROXY` in the app's own environment have no effect;
  configure the proxy in **Settings → Network**. `apiweave run` does read those
  variables and also takes `--proxy`.

Private certificate authorities, the operating system certificate store and
client certificates (mTLS) are supported and configured in the same settings
page or through the CLI flags.
- **gRPC calls are not proxied.** The gRPC node uses the CA, client certificate
  and TLS verification settings, but connects directly: the proxy does not apply
  to it.
- **gRPC is unary only.** A method that streams is refused. Server streaming is
  planned; client and bidirectional streaming are not.

## Execution

- **Workflows have no loops.** A connection that leads back to an earlier node
  is refused on the canvas, and a graph that contains a cycle fails before any
  request. To poll an async API, use the HTTP node's **Retry** rules instead of
  a loop. To repeat a step over a list, use **For each** on a Call Workflow
  node; it runs the target once per item, at most 1000 items (further items are
  not run) and at most 16 at once, and the nesting limit of 8 still applies.
- **A Delay runs once.** It pauses the run for a fixed time and continues; a
  workflow cannot loop back through it.
- **WebSocket and SSE nodes are bounded probes.** They collect up to 100
  messages (1 MiB) and close; there is no long-lived or interactive session. A
  WebSocket node sends no cookies from the run's cookie jar, does not read the
  upgrade response's headers, and does not support Digest or AWS Signature V4
  auth.
- **There is no local scheduling.** Runs start from the app, from a local MCP
  client, or from `apiweave run` in your own CI. APIWeave does not run a
  workflow on a timer on your machine in 1.0.
- **There are no webhooks or remote triggers.** The app exposes no public port
  or inbound trigger, and there is no hosted execution or server-side run
  history.
- **There is no real-time collaboration.** The canvas is single-user on the
  machine it runs on. Sharing happens through a git remote, not a live session.
- **Run history is bounded.** Each workflow keeps its newest 100 runs and each
  project its newest 50 project runs; older finished runs are deleted with their
  node results.

## MCP and Agents

- **The MCP bridge is loopback only and off by default.** It binds
  `127.0.0.1`, requires a per-install bearer token, and has no remote endpoint,
  public port or webhook. You enable it in Settings.
- **The stdio MCP launcher needs Node.js 20 or newer.** It is the recommended
  client config because it starts APIWeave when it is not running, but the
  client runs it with your own `node`, which APIWeave does not install. Without
  Node.js, use the direct HTTP config, and start APIWeave before the client.
- **Connect your agents covers six clients, at user level only.** It
  configures Claude Code, Codex, OpenCode, Cursor, VS Code (default profile)
  and Claude Desktop, and only when you click. It never writes a project's
  config. Other clients, other VS Code profiles and VS Code Insiders are set up
  by hand.
- **Agent CLIs are yours to install.** APIWeave launches a local agent only
  when its CLI is already installed and authenticated on the machine. It does
  not bundle, proxy or resell access to Claude Code, Codex, OpenCode, Gemini or
  any other agent. See [Coding Agents](../features/coding-agents.md).
- **Not every agent is wired to the MCP server or briefed.** Cursor Agent,
  Aider, Crush and Pi have no per-launch way to receive the MCP server, and only
  Claude Code, OpenCode, Aider and Pi receive the session briefing. APIWeave
  never writes either into your repository or into a configuration file shared
  by every session.
- **Resume support varies by agent.** A finished session is resumable only when
  that agent's CLI exposes a session id and a resume flag APIWeave has confirmed.
  Cursor Agent and Aider never offer **Resume**, and Codex CLI, OpenCode and
  Crush offer it only once the agent has printed its session id.
- **Open at login on Linux uses XDG autostart.** It writes
  `~/.config/autostart/apiweave.desktop` (under `$XDG_CONFIG_HOME` when set),
  which GNOME, KDE, XFCE, Cinnamon and systemd's autostart generator read. A
  compositor that reads none of them, such as Hyprland or Sway without uwsm,
  needs `exec-once = apiweave --hidden` (or its equivalent) in its own config.
  Some desktops, such as stock GNOME, show no tray icon at all.
- **Agent runs that send secrets ask first.** A run an agent starts that would
  send stored secrets waits for a native approval naming the agent, workflow,
  secrets and destinations. **Skip secret approval for agent runs** can turn the
  question off for all agent-started runs, but the destination and script limits
  still apply.

## Secrets and Local Data

- **Secrets are machine-bound.** The per-install keyfile is sealed by the
  operating system keychain (Keychain on macOS, DPAPI on Windows, GNOME Keyring
  or KWallet on Linux). It opens only for the same operating system user on the
  same machine. On Linux without a running keyring it is stored unsealed, the
  log says so, and it is sealed in place once a keyring is available.
- **Losing the keyfile loses the secrets.** There is no recovery path. If
  `keyfile.json` is missing while the database holds secrets, APIWeave asks you
  to quit so you can restore the file, or to delete the secrets it can no longer
  open and continue.
- **Back up the whole data directory, not only the database.** Close APIWeave
  and copy the entire user data folder together: `apiweave.db`, `keyfile.json`,
  the tracked git repositories and the settings. Copying that folder is the
  supported way to move or restore a data directory; there is no in-app export
  or import for the whole store. The automatic copies under `backups/` are taken
  before a schema upgrade, keep the newest five, and contain the database only.
  A copied keyfile still only opens for the same user on the same machine, so
  moving to a new machine means re-entering the secrets.
- **Exports carry references, never values.** `.aweproject` bundles and
  workspace repositories keep `{{secrets.NAME}}` references and withheld
  credentials as `<SECRET>`; neither includes secret values or run history.
  JUnit and HTML run reports are built from the stored, masked run and leave out
  headers, bodies and variables.
- **There is no APIWeave Cloud.** The Cloud account, Cloud sync and hosted team
  workspaces are retired. Git is the only supported way to keep a workspace in
  sync between machines.

## Related

- [Installation](../getting-started/installation.md) — supported platforms and first-launch data locations
- [Releases and the Update Channel](release-and-updates.md) — signing, update paths and rollback
- [Keep Tests in a Git Repository](../guides/git-workflows.md) — repository layout, branches and merge behaviour
- [MCP Integration](../features/mcp-integration.md) — the loopback bridge and client setup
- [Coding Agents](../features/coding-agents.md) — launching agent CLIs, Resume and the tray
- [Compatibility and Deprecation Policy](compatibility.md) — what 1.x keeps stable
- [Changelog](../../CHANGELOG.md) — what changed in 1.0.0
