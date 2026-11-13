# Changelog

A record of notable changes to APIWeave. The current product is the local-first
Electron desktop app; the earlier self-hostable web application was retired and
its stack removed. Entries below describe the current desktop surface. A
separate **Retired surface** note at the end lists what was removed, for anyone
coming from an earlier build.

The format follows [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Contract checks against imported OpenAPI schemas.** An HTTP node has a
  `contract` setting (`off`, `warn` or `fail`) governing its `responseSchemas`
  check: `fail` for nodes imported from OpenAPI, `off` otherwise. A response
  status the spec does not declare is now a violation. `warn` records and shows
  violations without failing the node; the HTML and JUnit reports list them.
  `apiweave run --contract <off|warn|fail>` overrides the setting for a run,
  and **Settings → Contract check** sets it per node. This replaces the old
  always-on check, so a hand-built node with `responseSchemas` must set
  `contract` to be checked.

- **gRPC Call node.** A new `grpc` node calls a unary method of a gRPC server.
  The schema comes from server reflection (`grpc.reflection.v1`, falling back
  to `v1alpha`) or from `.proto` files stored inside the workflow, so they
  travel in `.aweproject` exports and git. The editor's **Discover** button
  lists services and unary methods and fills the message from a skeleton of the
  request type. The result exposes `response.body`, `status`, `statusCode`,
  `statusMessage`, `headers` and `trailers`; any status other than the
  configured `expectedStatus` (default `OK`) fails the node. Bearer and API-key
  auth become metadata, TLS follows Settings → Network (CAs and client
  certificates, not the proxy), and the read-only `grpc_discover` MCP tool lets
  agents list a server's schema. Streaming calls are not supported yet.

- **RFC 9535 JSONPath in the path resolver.** An extractor or assertion path
  beginning with `$` is now evaluated as JSONPath rooted at the node result
  (`$.response.body.items[?@.id==3].name`), alongside the existing dot grammar.
  A singular query returns the selected value, a non-singular query returns an
  array of every match, a query that matches nothing reports `path-missing`,
  and an expression the parser rejects reports a new `invalid-path` failure
  reason, surfaced in validation and the extractor preview. The grammar
  dispatch lives in `resolveExtractorPath`.
- **JSON-RPC 2.0 body type.** The HTTP request node now offers a JSON-RPC body
  type alongside GraphQL: a method, params (a JSON template, by name or by
  position) and an optional notification flag. It is POSTed as
  `application/json` with a per-request `id` that increases through the run, and
  a response carrying an `error` member fails the node with its code and message
  unless **Allow error responses** is turned on.
- **WebSocket node.** A new node opens a `ws://` or `wss://` connection, sends
  an ordered list of text or binary (base64) messages once the handshake
  completes, collects the incoming frames and closes on a finish rule, a
  message limit or a timeout. Like SSE it has **Ready** and **Complete**
  outputs, and its result exposes `response.body.messages`, `messageCount`,
  `termination`, `closeCode` and `closeReason`. Headers, auth (bearer, basic,
  API key, JWT, OAuth 2.0) and subprotocols go in the handshake, and the
  proxy, trusted CA, client certificate and TLS-verification settings apply.
  Finish rules accept dot paths and JSONPath.
- **For-each on Call Workflow.** A Call Workflow node can run its target once
  per item of a list: `forEach` takes `items` (a `{{...}}` placeholder, a JSON
  array literal, or a `$` JSONPath over `variables`, `env`, `data` and node
  results), an `itemVariable`, an optional `indexVariable`, `concurrency` from
  1 to 16 and `stopOnFailure`. Each iteration is its own run of the target,
  every output-mapping variable becomes an array in item order, the count is
  capped at 1000, and the node shows each iteration with a link to its run.
- **Load runs.** Run a workflow many times at once and measure it. In the
  desktop app, **Run options → Load run…** takes iterations or a data file,
  concurrency, an optional duration and ramp-up, and thresholds. In CI,
  `apiweave run --workflow <name> --concurrency 20 --iteration-count 500`
  adds `--duration`, `--ramp-up` and `--threshold "p95<500"` /
  `--threshold "errors<1%"`; a breached threshold exits `1`. A load run keeps
  per node the count, error rate, latency min/mean/p50/p90/p95/p99/max and
  throughput, plus the first failure of each node, and drops every other
  iteration's results. The console and HTML reports carry a latency table.
  See [Load Runs](docs/features/load-runs.md).

- **gRPC server streaming.** A gRPC Call node's `callType` also accepts
  `server-streaming`: the call is opened once and its decoded responses are
  collected until the server ends the stream, a finish rule matches, a response
  limit is reached or the deadline expires. Like SSE and WebSocket it has
  **Ready** and **Complete** outputs, and `response.body` carries `messages`,
  `messageCount` and `termination` beside the final status, status message and
  trailers. A non-OK final status fails the node unless it is the expected one.
  The Finish tab is shared by every stream node, so the finish-rule editor now
  lives in `StreamFinishConditionsEditor`.

- **SOAP and XML requests, XPath, and WSDL import.** An HTTP Request node takes
  `bodyType: "soap"` with a version (1.1 or 1.2), an action and a complete
  envelope, and sends the Content-Type and SOAPAction each version prescribes. A
  SOAP Fault fails the node unless its status is expected, with the fault's code
  and reason on `response.fault`. A path beginning with `xpath:` is now evaluated
  as XPath 1.0 over the response body as XML, with inline namespace declarations
  (`xpath[s=https://...]:/s:Envelope/...`), alongside dot paths and JSONPath.
  WSDL 1.1 import (**Import to Add Nodes → WSDL**) creates one POST node per
  operation from its port's `soap:address`. XML is parsed by
  `@xmldom/xmldom` and queried by `xpath`, both pure JavaScript; DTDs are
  refused so entity attacks never parse.

### Changed

- **SSE and WebSocket share one stream-listener lifecycle.** The executor's
  SSE-only handshake, consumer and completion code is now a protocol-neutral
  seam (`core/runner/stream_listener.ts`) driven by an adapter per protocol,
  and finish rules are one `StreamFinishCondition` evaluated by one function.
  SSE behaves as before. The `SseFinishCondition` type is renamed
  `StreamFinishCondition`.

## [1.0.0] — 2026-11-10

APIWeave 1.0 is the first release of the local-first desktop app as a supported
product. It brings the surface together: a visual canvas for building and
running API test workflows, git sync for a workspace's projects, workflows,
environments and node presets, a headless CI runner and standalone CLI package,
a loopback MCP bridge that agents can reach even while the app is closed, with
embedded coding agents beside the canvas, signed update manifests and a release
pipeline ready for OS code signing, and an accessibility-gated UI. It is the
first release covered by the 1.x compatibility policy.

The 1.0.0 installers are **not code-signed**. Windows SmartScreen may warn on
first launch (**More info → Run anyway**), and macOS Gatekeeper blocks the
first launch until you right-click the app and choose **Open**; see
[Installation](docs/getting-started/installation.md). Windows and the Linux
AppImage update in place; macOS and the `.deb`/`.rpm`/`.pacman` packages show
a new-version notice instead. Every update is still verified against the
update signing key built into the app before it can install.

### Added

- **Coding agents can reach APIWeave even when it is not running.** The MCP
  Server settings page now offers a stdio launcher — a small script a client
  runs with its own Node.js 20 or newer — in place of the direct HTTP URL. The
  launcher answers the handshake and lists the available tools from a catalog
  the app writes on every start, so an agent no longer sees the server as
  disconnected before APIWeave is opened. A tool call starts APIWeave hidden in
  the tray when the bridge is unreachable, then forwards the call over the
  existing loopback bridge; a dropped call is retried only when the tool is
  read-only, because a write may already have run. Node.js is the one
  requirement, and the page says so when it is missing.
- **Connect your agents.** One click per client writes the launcher into Claude
  Code's, Codex's, OpenCode's, Cursor's, VS Code's or Claude Desktop's own
  *user* settings, and **Disconnect** removes the `apiweave` entry again.
  Nothing is written until the user clicks, and only that entry is changed:
  JSON files are edited in place, so comments, formatting and other servers
  survive, and a file that cannot be parsed is left alone with an error naming
  it. Claude Code and Codex are written through their own `mcp add` commands.
  A session APIWeave launches for Codex or OpenCode then relies on the user
  entry instead of adding a second one it would merge into.
- **`/apiweave:e2e`.** A new MCP prompt is the one command that puts an agent to
  work testing with APIWeave: it finds the workspace, reads the service's code
  for real routes and fields, reuses existing workflows and conventions, builds
  journey-shaped workflows with extracted ids, assertions and negative cases,
  clears the diagnosis before running, and reports API bugs with evidence
  rather than weakening an assertion to make a run pass.

- **A release pipeline ready for OS code signing.** Once the certificate
  secrets are configured, the workflow signs macOS with a Developer ID
  certificate and notarizes it with Apple, and signs the Windows installer; a
  signed macOS build then updates itself in place. Both macOS architectures are
  packaged in one job, so a single `latest-mac.yml` covers the x64 and arm64
  zips, and update signatures gained a per-file map so the arm64 download is
  verified against its own bytes. Without the certificate secrets — as for
  1.0.0 itself — a release still builds, installs and is clearly labelled
  unsigned.
- **Base environments sync with a workspace's git repository.** An environment's
  base environment is written as its id in the environment file, validated on
  read (same workspace, no cycle, at most eight environments in a chain), and
  imported in two passes so a child may name a base that appears later in the
  snapshot. An environment whose base leaves the repository is cleared. The
  workspace format is now version 2; version 1 is still read, with every
  environment extending none, and a newer version is refused with an update
  message.
- **Node presets sync too.** A workspace's repository now holds
  `presets/<slug>--<id>.json` with the preset's stable id, name, node type and
  config. The config is sanitized like a node's (`{{secrets.NAME}}` references
  stay references), and no revision or timestamps are written. Deleting a preset
  file removes the preset locally; a preset only in the repository is created
  locally.
- **Choose the branch to track, and switch it later.** Connecting a remote and
  opening a workspace from git each offer the remote's branches with **Choose
  branch…**, and Version history has **Switch branch…**. A switch is refused
  while the current branch has commits the remote does not, while a merge waits,
  or when the target branch already exists locally with unpushed commits, so
  nothing is silently discarded; a successful switch imports the target branch's
  tree in one transaction.
- **A standalone CLI package.** Every release now attaches `apiweave-cli.tgz`,
  so a CI pipeline can install the headless runner with
  `npm install -g ./apiweave-cli.tgz` instead of cloning this repository and
  building it. The package is named `@apiweave/cli` and needs Node.js 22.12 or
  newer.
- **A 1.x compatibility policy.** The [compatibility
  reference](docs/reference/compatibility.md) states what stays stable for MCP
  tool names and arguments, the workspace repository format, the
  `.aweproject` schema and CLI flags and exit codes, and how deprecations
  work.
- **A sign-in offers the account's tagged workspaces.** When `gh` or `glab`
  finishes signing in, the dialog lists the repositories the account has
  tagged `apiweave-workspace` that hold a workspace not on this computer yet,
  all ticked, and **Open N workspaces** opens the ticked ones one at a time as
  that account. Nothing is cloned without being asked, so a workspace removed
  here is simply left unticked. Repositories already connected here, and empty
  ones, are not offered; each result, and any repository that could not be
  opened, is shown in the dialog.
- **GitHub accounts show their profile pictures.** The header's accounts menu
  and every GitHub account row load the picture from the host's public
  `/<login>.png` address, with no token and no tool call, and keep the initials
  while it loads and whenever it cannot (offline, or a private Enterprise host
  that requires sign-in). GitLab accounts keep their initials.

### Changed

- **Project bundles use the `.aweproject` extension.** The export filename, the
  import picker and detection, the bundle's `type` identifier, the headless CLI
  and the guides now name the format by its new extension. The JSON shape is
  unchanged.
- **Sync status no longer re-reads git for nothing.** A workspace's status now
  comes from what git last reported until the app next writes to the clone, so
  an edit, a cycle starting and the status Sync now returns cost no git
  processes of their own. On Windows, where starting git costs ~30 ms, an
  edit-and-sync drops from 23 to 14 processes and an idle sync from 16 to 10.
  The one thing it no longer sees is a git command run by hand inside a
  workspace's clone, until the next sync writes there.
- **The release pipeline builds both macOS architectures in one job.** That is
  what lets electron-builder write one `latest-mac.yml` covering both zips
  instead of two contradictory half-manifests, and it removes the finalize
  step that used to delete the manifest.
- **The renderer starts from a much smaller shell.** The canvas, the settings
  screens, the node editor and its export/import dialogs, and the embedded
  terminal are now loaded when they are first opened, and the Monaco editor
  registers only the editing features the app uses instead of its full feature
  set. The launch bundle drops from about 2.5 MB to under 500 KB (about 700 KB
  to 130 KB gzipped), and every JavaScript chunk is now under the 500 KB
  warning threshold; the editor core is split into on-demand chunks.
- **Connect to remote lists the repositories tagged `apiweave-workspace`**,
  including ones with commits, instead of only empty ones. A repository made
  before the topic existed appears once it is tagged, without being recreated.
- **Fonts are bundled.** The app no longer requests Inter or JetBrains Mono
  from Google Fonts at launch, so it loads no third-party font and works fully
  offline.
- **The platform floor is explicit.** The download requirements now state
  macOS 13 Ventura, glibc 2.34 on Linux, and Node.js 22.12 for source builds.
- **The unimplemented Parallel HAR import option is gone.** The import dialog
  only offers the linear mode it actually performs.
- **The embedded agent terminal runs on node-pty 1.1.0**, the current stable
  release, instead of a 1.2 beta. The PTY host still owns every agent session
  in its own process, and the packaged-app smoke test starts a real terminal.

### Fixed

- **Accessibility is gated in the UI suite.** The Playwright checks now scan
  the canvas shell, the workspace and app settings pages, and the node editor
  dialog against WCAG 2.1 A/AA, and fail on serious or critical findings.
  Fixing what the scan found: connection handles no longer carry ARIA labels
  that are illegal on a bare element; the workflow tab strip has one close
  control beside the tabs instead of a button inside each tab; the workspace
  switcher's accessible name includes the workspace it shows; muted text used
  for real labels and hints was raised to the secondary contrast; and the
  template suggestion fields expose the combobox role their ARIA attributes
  require.
- **Canvas edges stay attached after the shell resizes.** Turning the
  off-screen render optimisation off while the canvas is idle stops React Flow
  pruning edges during a sidebar or navigation collapse (issue #106).
- **Opening a workflow no longer flashes the graph in the wrong place.** The
  canvas mounts inside a resizable pane that has no width until after the first
  commit, so the first painted frame showed every node at ReactFlow's default
  transform with the toolbar collapsed to its narrowest tier; the correct view
  arrived a frame later. The canvas's contents now stay invisible until the
  opening view has been applied, so the first thing drawn is already the graph
  where it belongs with the toolbar at its full width. A workflow with no nodes
  opens immediately instead of waiting for a measurement that never comes.

## [0.22.0] — 2026-11-02

Agents can now orient themselves in a workspace and find every node that uses
a route or a credential without reading whole graphs, and APIWeave can keep
running in the tray so the MCP server and git sync stay reachable. See
[MCP Integration](docs/features/mcp-integration.md).

### Added

- **A map of a workspace for agents.** `workspaces_map` returns, per workflow
  and in pages of 30, the endpoints its request and SSE nodes call as
  `METHOD /path/{{…}}`, the variables it produces and consumes, the `env` and
  `secrets` names it references, the workflows it calls, and its latest run's
  status. It is built from names and path templates, never a config value;
  empty lists are left out and a list longer than 20 names is cut and counted
  in `omitted`.
- **Find every node that touches a route or a reference.**
  `workflows_searchNodes` now searches the whole workspace, or one project
  with `collectionId`, when `workflowId` is omitted. `query` matches a literal
  substring of the node id, label, type, request method, URL path or extractor
  name, and `ref` finds the nodes that use `variables.NAME`, `env.NAME` or
  `secrets.NAME` — in URLs, headers, query parameters, cookies, bodies,
  GraphQL, auth, scripts, extractor and assertion paths — marked `produces` or
  `consumes`, with the field each match was found in. Request matches carry
  `method` and `urlPath`. The command palette uses the same search.
- **Node schemas on demand.** `workflows_nodeSchema` returns one node type's
  config as JSON Schema, generated from the definitions the write path
  validates with, so the write tools advertise `config` as an open object
  instead of repeating the full per-type union. A rejected config names its
  node list and index in the error path, such as
  `["nodes", 1, "config", "body"]`.
- **Keep running in the tray.** **Settings > Background > Keep running in the
  tray** makes closing the window hide it instead of quitting, so the MCP
  bridge and git sync stay reachable with no window open; quit from the tray
  menu. **Open at login** starts the app hidden when you sign in, using
  Electron's login items on Windows and macOS and an XDG autostart entry on
  Linux (with an `exec-once` hint for compositors that do not read it). A
  second launch or a dock click shows a hidden window.
- **Skip secret approval for agent runs.** **Settings > MCP Server > Skip
  secret approval for agent runs** — off by default — removes the native
  approval question for every agent-started run. The destination and script
  limits still apply to each run. The preference is owned by the trusted
  bridge, so no MCP client can turn it on.
- **A code map for launched agents.** When a project's folder holds a graphify
  `graphify-out/graph.json`, the session briefing tells the agent to query it
  (`graphify query`, `graphify path`, `graphify explain`) instead of grepping;
  if graphify is installed but no graph exists, it suggests building one
  rather than running it unasked. Detection reads paths only, never repository
  files. **Settings > Agents** has a dismissible card with the install prompt,
  and the `start-here` guide points every other agent at the map.

### Changed

- **MCP reads are outline-first and bounded.** `workflows_get` defaults to an
  outline of node ids, types, labels and edges; `view: "nodes"` reads configs
  for named nodes, and `view: "full"` is refused above 64 KiB. Workflow search
  rows, run history, debug context and node evidence are compact projections
  with short cursors and explicit `omitted` counts, so a large workspace no
  longer arrives in one response.
- **One write path for agents.** `workflows_update` is gone; `workflows_patch`
  changes a subset by id, including name, description and tags, and both write
  tools lay out topology changes automatically. `guides_list` is gone too —
  `server_info` lists the guides and `guides_get` reads one.
- **The renderer stack is current.** React 19, React Router 7, Vite 8 and
  Vitest 5, Tailwind CSS 4 with daisyUI 5.7, Monaco 0.57 and xterm 6, with the
  renderer stylesheet cut from about 350 KB to 218 KB by scanning only the
  files it uses.

### Fixed

- **Settings page headers show the workspace name.** Secrets, Environments and
  Version history used to print the route's workspace id instead of the
  workspace's name.

### Security

- **Shipped dependencies patched.** Electron, the MCP SDK, zod, postcss and
  undici were updated to versions that clear the advisories affecting the
  packaged app.

## [0.21.0] — 2026-10-26

A workspace's git history can now sync as your GitHub or GitLab account, and
APIWeave can create the repository for it. See
[Keep Tests in a Git Repository](docs/guides/git-workflows.md).

### Added

- **GitHub and GitLab accounts.** The round account button at the right of the
  header lists every `gh` and `glab` account by host, shows which one the
  current workspace syncs as, and signs in to another. **Settings > App > Git
  accounts** shows the same accounts with each tool's version, an install link
  when it is missing, and the workspaces that use each account. A workspace
  connected over `https://` can sync as one account instead of whatever your
  credential helper answers with. `gh` keeps several accounts per host, so two
  GitHub accounts can each push to their own repositories; `glab` stores one
  account per host, so a second GitLab account needs a second host.
- **Sign in from APIWeave.** **Add GitHub account** or **Add GitLab account**
  runs the tool's own browser sign-in: the dialog shows the one-time code (with
  a copy button), opens the page to enter it on, offers **Open browser again**
  and stops the tool on **Cancel**. APIWeave stores no token; `gh` and `glab`
  keep it in the system keychain and are asked for one on every fetch, push and
  clone. Signing in does what the same command does in a terminal — on GitHub
  the account becomes `gh`'s active account there, on GitLab it replaces that
  host's account and sets it to HTTPS — and neither tool changes your git
  configuration.
- **Create the workspace's repository from the app.** **Create repository…**
  in **Version history (git)** makes an empty repository — no README, licence
  or first commit — private unless you choose public, owned by the account or
  one of its GitHub organizations or GitLab groups, tagged with the topic
  `apiweave-workspace`, and connects the workspace to it. A name that is
  already taken is refused by name, never reused, and APIWeave never deletes a
  repository; if the topic could not be added, the panel says so.
- **Pick a repository instead of pasting a URL.** When an account is signed in,
  every remote form asks for the **Account** first, then lists its
  **Repository**. **Connect to remote** lists that account's empty repositories
  it can push to, from the account and each of its organizations or groups;
  **Open from git…** lists the ones tagged `apiweave-workspace`, with **Show all
  repositories** for the rest. **Use a URL instead** still takes anything the
  list does not hold, and **Your own git sign-in (credential manager or SSH
  key) — another host** is for other hosts and for choosing no account.
- **Start a workspace already synced.** **Create workspace** has an optional
  **Sync with GitHub or GitLab** section, off by default, with the same account,
  owner, name and visibility fields. It creates the workspace, tracks it,
  creates the repository and connects to it. If git does not know who you are,
  the dialog asks for a name and email and carries on. If a later step fails,
  the workspace stays created — and tracked, once tracking has succeeded — and
  **Open Version history** takes you to finish it there.
- **Sync state in the workspace switcher.** Each tracked workspace's row shows
  the same state-coloured sync icon as the header, with its state as a tooltip;
  untracked rows are unchanged.
- **A tutorial chapter for version history and sync.** The lessons cover
  tracking a workspace, connecting a GitHub or GitLab account and its
  repository, syncing, opening a workspace on another machine, resolving a
  merge, and running a repository in CI.
- **A merge view for settling both copies.** **Review merge** opens a
  full-window **Resolve merge** view: the conflicts grouped under Workspace,
  Projects, Workflows, Environments and Files on the left, each with its count
  and whether it is **Resolved**; the selected item's fields on the right as
  **Yours**, **Result** and **Remote**, with **»** and **«** arrows taking a
  copy into the result (or **Use yours** and **Use remote** when the columns
  stack), an editable **Result**, and **Compare** for a read-only diff of a
  long value. **Accept yours** and **Accept remote** settle one item,
  **Accept all yours** and **Accept all remote** settle everything,
  **Previous conflict** and **Next conflict** (**Alt+↑** / **Alt+↓**) move
  between what is left, and **N changes merged automatically** lists the
  repairs the merge made on its own — positions, order, and an edge or frame a
  deletion left dangling — updated as choices are made, before **Finish
  merge**. Closing the view saves the choices.
- **A value of your own for a conflicted field.** Type into **Result** to
  settle a conflict with neither copy: text is edited as its text and stays
  text, any other value as JSON. The value is checked against the record when
  the merge finishes, a value holding secret storage or over the size limit is
  refused with a plain sentence, and a value that leaves the record invalid
  keeps the merge waiting with one copy as the way out.
- **Reconnect a workspace whose history was restarted.** **Stop tracking**
  deletes this device's history and tracking again starts a new one, so
  connecting the old repository used to be refused as unrelated history. When
  the repository holds the same workspace (the same `workspaceId`), the connect
  now starts a **two-way merge**: identical files pass, a record or file only
  one copy has is kept, and a place both copies hold with different values is a
  conflict in the merge view. A sync that finds the same situation — a recreated history folder,
  or the remote's branch replaced by another copy of this workspace — stops for
  a decision the same way. A repository holding a different workspace is still
  refused, naming it; ids that differ only in letter case say to rename the
  workspace; a repository a newer APIWeave wrote says to update the app.

### Changed

- **A waiting merge is settled in the merge view, not the old card picker.**
  The **Keep your copy** / **Keep remote copy** cards are gone; a field's
  choice is now an arrow into the result, or **Use yours** / **Use remote**
  when the columns stack, and a whole record or file is **Accept yours** /
  **Accept remote**. Closing the view saves the choices instead of losing the
  ones not sent, and **Finish merge** still sends them all.
- **A same-workspace repository with no shared history is merged, not
  refused.** Connecting it after **Stop tracking**, or syncing after this
  device's history folder was recreated, starts the two-way merge described
  above rather than sending you to **Open from git**, which could only answer
  that the workspace is already here. Nothing is pushed until every conflict is
  settled, and **Abandon merge** keeps this device's commits and offers the
  merge again on **Sync now**.
- **A local-only workspace says Local history, not Committed.** **Commit now**
  is offered only while there is something to commit, so a settled local
  history offers no action.
- **Sync icons are coloured by state** in the header and the workspace
  switcher: success when synced, muted for local history, info while syncing or
  with work waiting, warning when you must act, error when a sync failed.

### Requirements and limitations

- **Signing in to GitLab needs GitLab 17.9 or later**, whose device flow
  `glab auth login --device` uses, and a `glab` version whose
  `auth status --output json` APIWeave can read the accounts from.
- `gh` and `glab` are optional. Without them, connect a remote by its URL with
  your own git credentials, as before. Git itself is still required.

## [0.20.0] — 2026-10-22

APIWeave Cloud is gone. A workspace now syncs through a git repository you own,
on any git host. See [Keep Tests in a Git Repository](docs/guides/git-workflows.md).

### Added

- **Track a workspace in git.** **Settings > Workspace settings > Version
  history (git) > Track this workspace** keeps the workspace as a git
  repository on this machine: one JSON file per project, workflow and
  environment, written the same way on every machine, so a change reviews as a
  small diff. In auto mode a commit is made about 30 seconds after your last
  edit; with **Commit automatically** off, **Sync now** commits after listing
  what changed by name. Secret values never reach the repository:
  `{{secrets.NAME}}` references stay as written, and a credential typed into a
  request is written as `<SECRET>`. Git must be installed; APIWeave runs your
  own `git`, so your credentials and author apply.
- **Sync with a remote.** **Connect to remote** takes the HTTPS, SSH or
  `file://` URL of an empty repository and pushes the workspace's history to
  `main`. From then on the app fetches, brings in the remote's changes and
  pushes after each commit, at launch and every 5 minutes. A URL that carries a
  user name or password is refused.
- **Open a workspace from git.** **Open from git…** in the workspace switcher
  clones a repository that holds a workspace, checks every file before
  anything is created, and adds it as a workspace that syncs from then on. The
  repository holds no secret values: set the ones its `{{secrets.NAME}}`
  references use, and the dialog lists any credential withheld as `<SECRET>`.
- **Edits made on two machines merge.** When both sides changed, the app
  merges them by record, node and field. Changes that don't overlap are
  combined into a real merge commit, and nothing either side committed is
  lost. A field both sides changed differently waits as **Merge needed**:
  **Review merge** shows **Your copy** and **Remote copy** side by side, to
  keep one per field or for a whole record. **Abandon merge** keeps every local
  commit, and **Sync now** offers the merge again.
- **Sync status in the header.** A tracked workspace shows **Synced**,
  **Pending**, **Syncing**, **Incoming**, **Merging**, **Diverged**,
  **Read-only** or **Sync error** as an icon and a word, with a popover that
  says what it means and what to do. A host that refuses your push makes the
  workspace read-only instead of failing: edits keep committing locally until
  a push succeeds. Git failures are explained in plain words, with git's own
  text underneath.
- **`apiweave run` runs a workspace repository.** Point it at a checkout of
  the connected repository: `apiweave run ./my-tests`. It runs every project
  in the repository's order, or one with `--project` or `--workflow`, and
  `--bail` stops at the first project that did not complete. JUnit suites are
  named `<project>: <workflow>`. It needs no git and no database.

### Removed

- **APIWeave Cloud.** The Cloud account, Cloud sync, shared Team workspaces,
  devices, roles, end-to-end-encrypted Cloud workspaces and the Cloud conflict
  pages are gone. On upgrade the app deletes its Cloud tables and settings;
  every workspace, workflow, environment and secret on this machine stays. To
  share a workspace, track it in git and connect a remote.
- **Export to Folder and Import from Folder.** A tracked workspace's
  repository replaces them, and `apiweave run` reads it directly.
  `.awecollection` bundles, single workflow exports and Postman collections
  import and run as before.

### Known limitations

- A workspace syncs one branch: `main`, or the default branch of a repository
  opened from git. There is no branch picker.
- An environment's base environment is not written to the repository; put the
  variables a run needs in the environment itself.

## [0.12.1] — 2026-10-13

### Added

- **The agent approval dialog can stop asking.** A run an agent starts that
  would send secrets still asks the first time, but the dialog now also offers
  **Allow for this session** — no more asking for that workflow until APIWeave
  restarts — and **Never ask again**, which remembers the answer across
  restarts. Both stop matching, and the question returns, as soon as the
  workflow's secrets, destinations or scripts change, and remembered answers
  are listed, with a revoke action, under Settings > MCP Server.

## [0.12.0] — 2026-10-13

### Security

- **An agent can no longer send your secrets anywhere without asking.** A
  local agent could write a workflow that sends any stored secret to a host it
  controls, then run it over MCP. A run an agent starts that would send secrets
  now waits for you to approve it in a native dialog that names the agent, the
  workflow, the secrets and the destinations. Deny, or no answer within two
  minutes, fails the run before any request, and the agent sees
  `deniedByUser: true`. A run also now executes the Call Workflow targets as
  they were when it started.
- **The secrets key is sealed by the OS keychain.** `keyfile.json` held the
  master key in plaintext beside the database. It is now sealed with the
  operating system keychain (Keychain, DPAPI, GNOME Keyring or KWallet), and an
  existing plaintext keyfile is sealed in place on first launch. On Linux
  without a keyring it stays unsealed and the log warns. A sealed keyfile opens
  only for the same user on the same machine, so secrets no longer move with a
  copied data folder.
- **A missing keyfile no longer orphans your secrets silently.** If
  `keyfile.json` is missing or cannot be opened while the database holds
  secrets, APIWeave asks whether to quit, so the keyfile can be restored, or to
  delete the secrets it cannot open and continue. It used to create a new
  keyfile without a word.
- **The MCP token can be regenerated.** MCP settings have a **Regenerate
  token** action that replaces the access token and closes the sessions opened
  with the old one.
- **The MCP server only answers to its own address.** Requests whose `Host`
  header is not `127.0.0.1:<port>` or `localhost:<port>` are refused, so a web
  page that rebinds its domain to the loopback address cannot reach it.
- **A workflow name cannot pose as agent instructions.** The session briefing
  quotes the workflow or project name as a JSON string, so a name containing
  line breaks or Markdown cannot add headings or instructions of its own.
- **Prompts are escaped for `cmd.exe` on Windows.** An agent installed as a
  `.cmd` shim (most npm-installed CLIs) runs through `cmd.exe`, which acted on
  `&`, `|`, `%` and similar characters in the prompt. The embedded terminal now
  escapes them; a prompt with a line break is refused there, since `cmd.exe`
  cannot carry one. Launching such an agent in an external terminal refuses
  those characters instead.
- **Updates are signed, and the app refuses one that is not.** Releases sign
  each Windows and AppImage update with a private key held as a CI secret,
  and the app checks the downloaded installer against the key built
  into it before it can install. A download that fails is never installed, and
  the Updates panel says why. Previously anyone able to write a GitHub release
  asset could ship code to every install.
- **Packaged builds are locked down.** Electron fuses now ignore
  `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS` and `--inspect`,
  load only the integrity-checked `app.asar`, and encrypt cookies at rest. A
  packaged build ignores `APIWEAVE_FRONTEND_DIST`. The window has a full
  Content Security Policy instead of one covering only scripts, every web
  permission except clipboard access is denied, and the window can no longer
  be navigated to `file:` or `data:` URLs.

### Fixed

- **The environment editor lists the environment's secrets.** Its Secrets panel
  read a field the app no longer fills, so it always said there were none. It
  now lists the secrets stored for the environment.

- **Node search no longer reads a password written into a URL.** The URL path
  that node search matches (`workflows_searchNodes`) kept the whole URL when it
  could not be parsed, such as `https://user:pass@{{env.HOST}}/login`, so a
  literal password in it was searchable. Search now drops the scheme and
  authority, and matches placeholders as written rather than percent-encoded.

- **A request dragged from an imported OpenAPI group saves.** Its node carried
  `openapiMeta`, which the workflow schema did not accept, so every save of the
  workflow failed afterwards. The field is now part of the HTTP Request node, so
  the `Check API` drift badge also survives a reload.

- **Typing in an assertion rule no longer loses focus after each character.**
  Each rule card was keyed by its own contents and remounted on every
  keystroke.

- **Imported Call Workflow nodes call the imported workflows.** Importing a
  project, in the app or with `apiweave run`, left each Call Workflow node
  pointing at the original workflow, so it failed. It now points at the
  imported copy. A target outside the bundle is kept when it exists in the
  destination workspace and cleared otherwise, and the import lists each
  cleared target. A failing Call Workflow node now says why, such as
  `Called workflow <id> not found`, instead of `Node execution failed`.

- **A workflow imported into a project lands in it, or not at all.** The
  project's **Import Workflows** tab imported the workflow and then added it to
  the project in a second step; if that step failed, the workflow was left
  outside the project. Both now happen in one write.

- **Cancelling a run during a Delay node stops it.** A cancel that landed just
  before a Delay node began was missed, and the run waited out the whole delay
  while still showing as running.

- **Importing cURL commands as nodes no longer creates a workflow.** Adding
  pasted cURL commands to the **Add Nodes** panel also created a stray workflow
  in the sidebar. The commands are now only parsed, as HAR and OpenAPI
  imports already were.

- **A JSON body is always labelled JSON.** A JSON body typed as text went out
  without a `Content-Type`, so servers read it as plain text. It now carries
  `application/json` unless the request sets its own `Content-Type`.

- **An object or array placeholder value is sent as JSON.** A placeholder
  whose value was an object or array, such as an extracted response body, was
  sent as `[object Object]`. It now becomes its JSON text, inserted as a
  nested value when it stands alone in a JSON body.

- **Deleting an environment deletes its secrets.** Environment-scoped secrets
  used to stay in the database, unreachable, after their environment was
  deleted, whether locally or by a cloud sync. They now go with it, and the
  update removes the ones already left behind.

- **A failed workflow import leaves nothing behind.** Importing a workflow
  bundle with its environment created the environment first, so a bundle whose
  workflow was then rejected left a stray environment. Both are now written in
  one transaction, as a project import already was.

- **The database is backed up before an upgrade and checked at every launch.**
  Before a new version changes the database schema, a copy is saved to
  `backups/` in the data folder (the five newest are kept), and a failed
  upgrade names that copy in the startup error. Every launch runs a quick
  integrity check, and a damaged database stops startup with an error that
  points at the backups instead of failing later. Once deletes leave a quarter
  of the file empty, it is compacted at launch.

- **A loop in a workflow no longer sends thousands of requests.** A cycle
  drawn on the canvas ran until a 10,000-step budget gave out, sending a real
  request each time round. The canvas now refuses a connection that leads back
  to an earlier node and says why, and a run of a graph that has a cycle
  anyway fails before any request with `Workflow contains a cycle: A → B → A`.
- **A `"` in a variable or secret no longer breaks a JSON body.** A
  placeholder inside a JSON string is now JSON-escaped, so quotes,
  backslashes and line breaks in its value stay inside the string. A
  placeholder standing alone as a value (`"id": {{variables.id}}`) is still
  inserted as is. This applies to JSON bodies and to raw bodies with a JSON
  `Content-Type`.
- **A huge generated length fails the node instead of the app.**
  `randomString`, `randomAlpha`, `randomNumeric`, `randomHex` and
  `randomNumber` refuse a length above 10,000 and fail the node with that
  message; `{{randomString(1000000000)}}` could exhaust memory. A dynamic
  function that rejects its input now always fails the node instead of
  sending the placeholder text verbatim.
- **`{{randomChoice(a,b,c)}}` picks from every option.** It always returned
  the first one, because the options arrived as separate arguments and only
  the first was read.
- **Ctrl+R during a run no longer reloads the window.** Electron's default
  menu was still installed behind the frameless window, and its Reload
  (Ctrl+R) and Close (Ctrl+W) accelerators answered any keystroke the app did
  not claim, so Ctrl+R while a run was going reloaded the window. Windows and
  Linux now have no application menu; macOS has only the App, Edit and Window
  menus, so Cmd+C, Cmd+V and Cmd+Q keep working.
- **Deleting a synced workspace now deletes it in Cloud.** The deletion was
  queued in a table that the local delete emptied, so it never reached the
  server. It is now kept in its own queue, survives restarts and network
  failures, and is pushed even after the workspace's sync binding is gone.
- **A local edit and its queued cloud change are saved together.** They were
  two separate writes, so a failure between them could keep an edit that never
  synced. Now both are saved, or neither is.
- **Disconnect says what it throws away.** The confirmation now counts the
  changes not yet synced and the failed changes that disconnecting discards,
  and offers **Sync now** first while anything is unsynced.
- **Linking a cloud account asks about unsaved tabs first.** Linking from the
  signed-out state closes every tab, and it did so after the account changed,
  losing unsaved edits. It now asks **Save**, **Discard**, or **Cancel** for
  each such tab before signing in, and **Cancel** stops the link.
- **A canvas save no longer overwrites an agent's edit.** Saves now carry the
  revision the canvas loaded, and a workflow changed elsewhere since (over MCP,
  cloud sync, another window) refuses the save instead of being silently
  replaced. Your edits stay on the canvas, and a notice offers **Load latest**
  or **Overwrite**. `workflows_update` accepts `expectedRevision` as well.

- **Redirects no longer leak credentials or resend a POST.** A followed
  redirect to another origin drops `Authorization`, `Cookie` and
  `Proxy-Authorization`; a redirect from HTTPS to HTTP is refused; a 303, or a
  301/302 answering a POST, is followed with a GET and no body. Previously every
  hop resent the headers, method and body to wherever the server pointed.
- **Every Set-Cookie header is kept.** A response setting several cookies kept
  only the last one, so assertions and extractors on the others failed. The
  `set-cookie` header now holds every cookie, one per line.
- **A failed request says why.** DNS failures, refused or reset connections and
  TLS errors (expired, self-signed or mismatched certificates) are now reported
  with their cause and code, such as "Network error: connection refused by
  localhost:8080 (ECONNREFUSED)", instead of "Node execution failed".
- **Large and binary response bodies are kept honestly.** A body over 1 MiB is
  stored up to 1 MiB and marked truncated with its full size, instead of being
  left empty when the server sent a `Content-Length`. A body that is not UTF-8
  text is stored as base64 instead of corrupted text.
- Turning off TLS verification on a node no longer opens a new connection pool
  for every request.
- **A cancelled run is recorded as cancelled.** Cancelling a run, including one
  waiting in a Delay or a Merge, now saves it as `cancelled` in History and in
  Call Workflow sub-runs, with the interrupted node shown as skipped.
  Previously it was saved as completed or failed, and a cancel during a Delay
  showed the run as passed. A Merge waiting on its branches now stops on cancel
  instead of waiting out its 30 s window.
- **An HTTP request node's timeout is honoured above 30 s.** The node's timeout
  is now the request's only deadline; a hidden 30 s cap cut longer timeouts
  short. A timed-out request now says "Request timed out after Ns", and a
  cancelled one is no longer reported as a timeout.
- **Secrets used only inside a called workflow are resolved.** A
  `{{secrets.*}}` placeholder that appears only in a Call Workflow target (at
  any depth) was sent as literal text; secrets for the whole call tree are now
  resolved when the run starts, and masked in its history like any other.
- **Secret values no longer reach the run history.** Every secret a run
  resolves is now replaced with `<SECRET>` in what the run stores and streams:
  request URLs, response headers and bodies (including an API that echoes your
  `Authorization` header), extracted variables and messages, in Call Workflow
  sub-runs too. URL-encoded and JSON-escaped forms and `Basic` credentials are
  caught as well. Previously only the URL query string was hidden, so a secret
  echoed in a response was stored in plain text. Secrets shorter than four
  characters are not masked.
- **A failed start no longer leaves a dead process behind.** When startup fails
  before the window opens (a database from a newer build, a failed migration, an
  unreadable keyfile), APIWeave shows an error naming the cause, the log file and
  the data folder, then exits. Previously the process stayed running without a
  window and held the single-instance lock, so every relaunch silently did
  nothing.
- **Recent edits are no longer lost on tab close or quit.** The pending 700 ms
  auto-save is sent when a tab is switched or closed and before the app quits,
  instead of being dropped. Closing a tab or quitting with changes that are still
  unsaved (auto-save off, or a failed save) now asks **Save**, **Discard** or
  **Cancel** instead of discarding them silently.
- **Switching tabs no longer discards unsaved edits.** With auto-save off (or
  after a failed save), a tab you switch away from keeps its unsaved changes,
  shows the unsaved dot, and brings them back when you return to it. Closing
  that tab, quitting, or disconnecting the cloud account asks **Save**,
  **Discard** or **Cancel** about it, and **Cancel** keeps the account linked.
- **The node editor no longer throws away edits.** Escape, a click outside the
  editor and its close button now keep the edits, as Previous and Next already
  did; only **Cancel** discards them. `Ctrl+S` (`Cmd+S` on macOS) inside the
  editor, including in its text fields, applies the edits to the node and saves
  the workflow, and the editor stays open.
- **A crashed window can be recovered.** If the renderer process dies, a dialog
  offers **Reload** or **Quit** instead of leaving a blank window.
- **A render error no longer blanks the window.** A view that fails to draw
  (a page, the canvas, or the response inspector in the node editor) is replaced
  by a message with the error and **Try again**, **Reload** and **Copy error
  details**; the rest of the app keeps working, and the error is written to the
  log.
- **The JSON editor no longer throws away edits.** Escape, a click outside and
  the close button used to discard unapplied JSON. With changed text they now
  ask **Apply**, **Discard** or **Keep editing**.

- **Run history no longer grows without limit or slows down long runs.** Each
  workflow keeps its newest 100 runs; older finished runs are deleted, with
  their node results and response bodies, whenever a run finishes. The History
  panel loads compact run summaries a page at a time and fetches a run's full
  results only when you open it. Storing each node's result no longer rewrites
  every earlier result of the run, so a run with many nodes no longer gets
  slower with every node that completes.
- **Importing a file into a project works.** From a project's import dialog, a
  workflow bundle always failed validation, and an OpenAPI or HAR file failed
  to create its workflow. Both now create the workflow in the project. The HAR
  preview also now honours the chosen import mode and the **Sanitize** option,
  which it used to ignore.
- **Large JSON responses no longer freeze the window.** The response tree
  opened every row of the body, so a 1 MB response mounted hundreds of
  thousands of elements. A collection with more than 100 entries now starts
  collapsed, and a body over 100 KB opens one level at a time.
- **The node editor's header badges show their tooltips.** The rule count,
  delay, merge strategy and called-workflow badges had tooltips that never
  appeared.
- **The import dialogs, Run History and the tab bar work from the keyboard
  and with a screen reader.** The curl, HAR, OpenAPI, project and Import to
  Add Nodes dialogs and Run History are modal dialogs: they are announced with
  their title, keep focus inside while open and close on Escape. The workflow
  tab bar and every panel tab strip are tab lists: the arrow keys, Home and End
  move between tabs.
- **Keyboard shortcuts use ⌘ on macOS.** Every Ctrl shortcut now answers ⌘
  on a Mac (Ctrl+Tab stays on Control, since ⌘Tab switches apps), the labels
  in the help, command palette and hints show ⌘, and Backspace deletes the
  selected nodes, since a Mac keyboard has no Delete key. The shortcuts help
  now lists every shortcut, undo, redo and grouping included: it reads the
  same table the key handlers match against.
- **Copy, paste and duplicate act on the whole selection.** They used to take
  one node and drop its connections. They now take every selected node, the
  nodes inside a selected frame, and the edges between them; the paste gets
  new ids, lands offset from the originals and is selected.

### Added

- **Import environment variables from a file.** **Import variables…** in the
  environment editor reads a `.env` file, a flat JSON object or a Postman
  environment export, previews each key as new, changed or unchanged, and keeps
  or overwrites existing values as you choose. Keys that look like credentials
  are imported as secrets by default: sealed into the environment's secret
  store and never shown or written as plain variables. **Export .env** saves
  the plain variables.

- **Search workflows and nodes from the command palette.** `Ctrl+K` now finds
  workflows by name and nodes in any workflow by label, method, URL path or
  extractor name, with the match highlighted. Choosing a node opens its
  workflow and centres the canvas on it.

- **Keep tests in a git repository.** **Export to Folder** writes a project
  as plain JSON: `project.json` (order, enabled / continue on fail, secret
  names), one file per workflow under `workflows/` and one per environment
  under `environments/`. Files are written deterministically (sorted keys,
  nodes and edges by id, whole-pixel positions, no timestamps or revisions),
  so a one-node change diffs as one line and teammates merge cleanly.
  Exporting again updates the folder in place and removes only the files it
  wrote for deleted or renamed workflows. **Import from Folder** creates or
  updates the project by id; a changed workflow keeps its previous version in
  history, an unchanged one is not touched, and one missing from the folder
  is moved out of the project, not deleted. `apiweave run <folder>` runs the
  folder in CI. Secret values are never written. See
  `docs/guides/git-workflows.md`.
- **Version history.** Every workflow keeps its earlier versions — the
  workflow as it was before a change replaced it — so a bad auto-save, an
  agent's edit, an import or a cloud sync can be undone. A version is kept at
  most every 10 minutes of canvas editing and always before any other change;
  the newest 50 are kept, for up to 90 days. **Version history** on the
  toolbar shows what restoring a version would change and restores it, as a
  change you can undo the same way. Versions stay on this computer. Agents can
  list them (`workflows_listRevisions`); restoring is the user's.

- **Rerun from a node, or rerun failed branches.** After fixing a failed step,
  rerun only that part of the workflow: **Run from here** on a step (its node
  menu or right-click), or **Rerun failed branches** from the Run menu or a
  failed run in History. Upstream steps are not sent again — their stored
  results and variables are reused, merges join the branches that passed, and
  a rerun that would need a value history only holds masked is refused instead
  of sending `<SECRET>`. The new run is marked **Rerun of** its source in
  History. Agents pass `resume` to `runs_create`.

- **JWT Bearer auth.** HTTP nodes can sign a fresh JWT for every request
  (HS256, RS256 or ES256) from a payload template with placeholders, adding
  `iat` and, by default, a five-minute `exp`, and send it as a bearer token or
  in a header of your choice. The signing key is a `{{secrets.NAME}}`
  reference (a PEM key that lost its line breaks still works), and every
  signed token is masked in run history and reports.
- **HTTP Digest auth.** HTTP nodes can authenticate with Digest (RFC 7616,
  MD5 or SHA-256 and their `-sess` variants, `qop=auth`): the request is sent,
  and answered once more with credentials when the server challenges it. The
  password is a `{{secrets.NAME}}` reference.
- **AWS Signature V4 auth.** HTTP nodes can sign their requests for AWS APIs
  with an access key ID, a secret access key and an optional session token
  (both `{{secrets.NAME}}` references), a region and a service. The request is
  signed last, after the pre-request script, and again on every retry attempt;
  a signed request does not follow redirects. Works in the CLI with secrets
  from the environment.
- **GraphQL requests.** HTTP nodes gain a GraphQL body type with a
  highlighted query editor, a JSON variables editor and an optional operation
  name. It is sent as `{query, variables, operationName}` JSON, or as query
  parameters for a `GET`. Placeholders work in all three; the variables are a
  JSON template, so a standalone `{{variables.id}}` can be a number. Postman
  GraphQL bodies now import as GraphQL. To fail on a `200` that carries GraphQL
  `errors`, assert `response.body.errors` **not exists**.
- **Proxy, private CAs and client certificates (mTLS).** Settings > Network
  sends every request through an http(s) proxy (with a bypass list and Basic
  credentials), trusts the operating system's certificate store (on by
  default, so a corporate root installed there just works in the packaged app,
  which ignores `NODE_EXTRA_CA_CERTS`) and extra PEM CA files, and presents a
  client certificate (PEM certificate and key, or PFX) to the hosts it names.
  Files are checked when saved; the proxy password and passphrases are stored
  encrypted and never shown again. The settings are not reachable over MCP. The
  CLI gains `--proxy` (and honours `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`),
  `--ca-cert`, `--use-system-ca` and `--client-cert host=cert,key[,SECRET]`.
- **Automatic cookies.** Each run keeps a cookie jar: a cookie a response sets,
  including on a redirect, is sent by every later request of the run that it
  matches by domain, path, `Secure` and expiry, so a session-cookie login works
  across nodes without extracting the cookie. A Call Workflow child shares its
  caller's jar. A node's own cookie rows override the jar's cookie of the same
  name, and **Use cookie jar** (on by default) turns it off for one request.
- **Response validation: regex, type and JSON Schema operators.** Assertion
  rules (and Retry `until` rules and SSE finish conditions) gain `matches` and
  `notMatches` (a regular expression, bare or `/pattern/flags`), `type`
  (`string`, `number`, `integer`, `boolean`, `object`, `array`, `null`) and
  `matchesSchema` (an inline JSON Schema, draft 2020-12 by default, or draft-07,
  2019-09 or draft-04 by its `$schema`). A failed schema rule lists its first 10
  violations with where in the value and why, in the node's result, JUnit and
  HTML reports and the CLI console. A regex match runs in the QuickJS sandbox
  and is stopped after 100 ms, so a backtracking pattern cannot freeze the app;
  values over 100,000 characters fail the rule. Schemas are interpreted by
  `@cfworker/json-schema`, never compiled to code. A value of the wrong shape
  for its operator is flagged before the run (`assertion_expected_invalid`).
- **Contract checks from OpenAPI.** An HTTP Request node can carry
  `responseSchemas`: a JSON Schema per status (`200`, `2XX`, `default`) that the
  response body must match, or the node fails with the violations. OpenAPI and
  Swagger import fills it from each operation's JSON responses, with every
  `$ref` resolved into the schema and OpenAPI 3.0's `nullable` and Swagger's
  dialect converted; **Add schema assertions** in the import dialog turns it
  off. **Settings → Response schemas** lists and removes them.
- **Scripts on HTTP requests.** An HTTP Request node has a **Scripts** tab
  with a pre-request script, which runs on the resolved request just before it
  is sent and can change its method, URL, headers and body (sign it with
  `aw.crypto.hmacSha256`), and a post-response script, which reads the
  response, sets workflow variables and runs custom checks with
  `aw.test(name, fn)` and `aw.expect(value)`; a failed test or a thrown error
  fails the node, naming the script's line and column. Scripts are synchronous
  JavaScript in a sandbox (QuickJS compiled to WebAssembly) with no network,
  file system or timers, a time limit (1 s by default, up to 30 s) and a 32 MB
  memory limit. They read secrets only by literal name, `aw.secrets.get("NAME")`,
  so those secrets are resolved up front, masked in console output and results,
  required by `apiweave run`, and covered by the approval an agent's run needs;
  the approval dialog now also says when a workflow runs scripts. Console
  output and test results appear in the node's output, run history, JUnit
  (`<system-out>`), HTML and console reports. Imported Postman scripts are
  still kept as notes, and can now be ported by hand. See
  [Scripting](docs/features/scripting.md).
- **Import Postman collections.** **Projects → Import → Postman** turns a
  Postman Collection v2.1, and optionally a Postman environment, into a new
  project: one workflow per folder (nested folders named `Parent / Child`) or
  one per request, each request with its method, URL, query, path variables,
  headers, body (raw, urlencoded, form-data text fields, GraphQL) and
  inherited auth (bearer, basic, API key, OAuth 2.0). Variables go to one
  **Postman: …** environment, dynamic variables such as `{{$guid}}` to
  APIWeave's dynamic functions, and test scripts that check the status or
  store a response value to Expected status and extractors; other scripts are
  kept in a note. Credential values are never imported: each becomes a
  `{{secrets.NAME}}` reference, and the preview lists the secrets to create.
  `apiweave run` runs a Postman collection directly. Collection v1 and v2.0
  files are refused with a request to re-export. See
  [Migrate from Postman](docs/guides/migrating-from-postman.md).
- **OAuth 2.0 for HTTP requests.** The Auth tab offers OAuth 2.0 with two
  grant types. **Client credentials** runs headless, in the app and in
  `apiweave run`: the token is fetched before the request, reused until it
  nears expiry, and fetched again once if the API answers 401. **Authorization
  code with PKCE** signs in once through **Get token**, which opens your
  browser and receives the redirect on a one-time `127.0.0.1` listener; the
  access and refresh token are sealed in a secret you name, refreshed
  automatically when they expire, and never stored in the workflow or an
  export. The CLI takes a refresh token as that secret. Client secrets are
  `{{secrets.NAME}}` references only, and every fetched token is masked in run
  history, events and reports.
- **Data-driven runs from a CSV or JSON file.** A workflow can run once per
  row of a data file, each row's values read as `{{data.<column>}}`: a CSV
  file's header names the columns, a JSON file is an array of objects. In the
  app, **Run with data** beside **Run** picks the file; the toolbar shows
  **Iteration 3/10**, each iteration is its own History entry with its place,
  a failed iteration does not stop the next, and Cancel stops the rest. In CI,
  `apiweave run --iteration-data <file>` (`-d`) does the same for a workflow or
  a whole project, `--iteration-count` (`-n`) repeats a run, `--bail` stops at
  the first failed iteration, and the reports have one suite per iteration
  (`Health check [iteration 2]`). Agents pass one row as `data` on
  `runs_create`. Row values are never stored with a run and are not masked:
  keep secrets in the secret store.
- **Poll async APIs with Retry.** An HTTP request can now repeat itself:
  **Settings → Retry** sets the attempts, the wait (fixed or exponential with
  a cap) and **Until** rules, the same rules an Assertion node takes, checked
  against the request's own response — for example status 200 and
  `response.body.status` equals `done`. Without rules it retries network
  errors, timeouts and 5xx responses. A run cancel stops it mid-wait; the
  result keeps every attempt, the output panel and canvas node show the
  count, and a condition that never holds fails the node with "Condition not
  met after N attempts". Reports and `apiweave run` list the attempts.
- **Run tests in CI with `apiweave run`.** A headless command runs an exported
  workflow or `.awecollection` project under plain Node, with no Electron and
  no window, and exits 0 when every run passes, 1 when a test fails and 2 on a
  usage or configuration error. Pick an environment from the file with
  `--env`, layer values on it with `--env-file` and `--var`, and supply
  secrets as `APIWEAVE_SECRET_<NAME>` variables, `--secret` or
  `--secrets-file`; a missing secret stops the run before any request, and
  secret values are masked in all output. It prints a per-step console report
  and writes the JUnit and HTML reports (`--reporter cli,junit,html`), with
  `--bail`, `--timeout-request` and `--insecure`. Build it from `app/` with
  `npm run build:cli`; see the new CI guide for a GitHub Actions job.
- **Run a whole project.** The project page has a **Run project** button: pick
  an environment and every enabled workflow runs in the project's order, each
  as an ordinary run with its own History entry. A failed workflow stops the
  project unless its row says **Continue**; the workflows after a stop are
  skipped. The card follows the run live, opens any workflow's run, cancels,
  and lists earlier project runs (the newest 50 per project are kept). Agents
  can do the same over MCP with `projects_run`, `projects_getRun`,
  `projects_listRuns` and `projects_cancelRun`; an agent's project run still
  asks before any workflow sends secrets.
- **JUnit and HTML run reports.** Export a finished run from History, or a
  finished project run from its card, as JUnit XML for CI or as one
  self-contained HTML page; APIWeave asks where to save it. A project run
  report has one test suite per workflow. Reports are built from the stored,
  masked run and leave out headers, bodies and variables. The unused
  temp-folder report artifacts and their handlers are gone.
- **Delete runs from History.** Each finished run in the History panel has a
  delete button, and **Clear history** deletes every finished run of the
  workflow. Runs still in progress are kept. Agents connected through MCP
  cannot delete run history.
- **Crash capture in the log.** Uncaught exceptions and unhandled rejections in
  the main process, renderer and child-process crashes (including the agent PTY
  host), failed loads and unresponsive windows are recorded in the daily log
  file, and each session's log opens with the app, Electron and OS versions.

### Changed

- **The installed app is about 165 MB smaller.** Every library the window
  uses was shipped twice: once inside the bundled renderer and again as a
  loose copy in the app archive, which grew to 183 MB. The archive now holds
  only the five packages the main process loads at runtime, and is 18 MB.

### Removed

- **The project-wide Continue on Failure toggle** in Manage Workflows. Project
  runs follow each workflow row's own Continue/Stop flag, so the project-wide
  switch had nothing to decide. The setting behind it is gone too: projects no
  longer store it, export it in `.awecollection` bundles or sync it. A bundle
  or a synced project that still carries it imports as before, without it.
- **The workflow-level Continue on Fail toggle.** It was never saved and the
  runner never read it, so it had no effect. Failure handling is per node:
  each node's **Continue on failure** toggle in its Settings tab.
- The renderer's startup gate, left over from the retired HTTP backend. Its
  spinner never showed and its error screen was unreachable.
- The web sign-in leftovers: the marketing landing page, the `/login` route,
  the admin route guard, the deployment-mode switch and an "Auth bootstrap
  failed" screen. The desktop app has one local owner, so none of them could
  be reached. The workspace switcher's **Manage workspaces** entry, which did
  nothing, is gone with them.
- The sidebar's workflow paging. The workflow list always returned every
  workflow, so the infinite scroll never loaded a second page; its "Showing
  all N workflows" footer is gone with it.
- Two unused packages: `@fallow-cli/beacon`, a coverage-telemetry SDK that
  nothing imported, and `axios`. Neither ran, but both shipped inside the app.

## [0.11.0] — 2026-09-23

### Added

- **In-app tutorial library.** A bundled, offline learning library — 24 lessons
  across seven chapters (First steps, Requests and data, Control flow, Debug and
  observe, Organize and reuse, Agents, App) — reachable from the header book
  icon, the workspace empty state, and the command palette (`learn`, `guide`,
  `tour`, `help`). Lessons open as a route in the same shell as the canvas, so
  opening one never closes a workflow tab, and each carries its outcome,
  prerequisites, numbered steps, an example, the expected result,
  troubleshooting, and related lessons. Progress and the last-read position are
  kept locally, and lessons that call a public endpoint say so.
- **Follow-along practice.** **Follow along** starts a practice session for a
  lesson and returns to the workspace, where the instructions float beside the
  canvas — a lower-left panel on a wide region, a resume strip on a narrow one.
  The practised lesson and step persist across restarts, and opening another
  lesson to consult it neither changes nor ends the session.
- **`{{...}}` autocomplete where references are typed.** The HTTP node's
  variable cheat sheet — which grew with the workflow until the node was mostly
  documentation — is gone; names now complete in the fields themselves. One
  matcher (prefix, then substring, then subsequence, so `{{variable.` still
  finds `variables.token`) drives a popover for plain inputs and textareas and a
  Monaco provider for the JSON body. Suggestions come from the workflow's
  variables, the active environment's, the reachable secret *names* (never
  values), the dynamic functions, and the response paths, and are wired into the
  node's URL, query, path, headers, cookies and body, the modal URL and
  JSON/raw bodies, every key/value row, the auth fields, the SSE URL, merge
  conditions, call-workflow mappings, and assertion values. The same pass
  corrects `{{prev.response.cookies.session}}`, an example that went out as
  literal text because the executor's result carries no cookies — only an
  assertion reads one.
- **Labelled JSON tree actions.** The response and node-output JSON trees show
  copy and save-as-variable as labelled pill buttons instead of unlabelled
  glyphs.

### Changed

- **Private-network targets are no longer blocked.** `SafeHttp` stopped
  blocklisting loopback, RFC1918, link-local, and IPv6 ULA addresses, so a node
  reaches a dev service on the machine that authored it, the way Postman or curl
  would. The **Settings → Private networks** opt-in added in 0.7.8 is removed
  end to end, with its IPC handlers and the `http.allow_private_networks`
  setting.
- **Electron 33 → 44** (Chromium 130 → 144). This fixes a GPU process
  segfault against Mesa 26.2 — on both the Wayland GBM scanout path and
  `EGL_CreateWindowSurface` under X11 — where Chromium silently demoted itself
  to SwiftShader for the rest of the session. better-sqlite3 12 → 13 (N-API) and
  electron-builder 25 → 26 come with it, and the now-unnecessary native-rebuild
  machinery is deleted.

### Fixed

- **Secret references survive sync and export.** A config field whose *key*
  looked sensitive (`token`, `apiKey`, …) dropped the whole field rather than
  keeping the key with a blanked value, so a `{{variables.token}}` /
  `{{secrets.*}}` / `{{env.*}}` wiring vanished from the cloud payload and the
  `.awecollection` bundle and dangled on the next pull. Sensitive leaves now
  keep their key and preserve a reference verbatim while blanking literals —
  including nested leaves, URL query values (duplicate parameters judged one by
  one, and base-reference templates), and extractor paths, which are response
  paths rather than credentials.
- **JSON body editor typing lag and dropped spaces.** The Body tab's Monaco
  editor fought a self-feedback loop: every keystroke normalized the whole HTTP
  config three times and echoed it back through a prop-synced effect, re-setting
  the editor's draft on every character. The panel now resyncs only from the
  node's saved config.
- **Expanded-node query, path, header and cookie fields save the shape they
  claim to.** Those textareas hold raw `key=value` text while the persisted
  contract is `KeyValuePair[]`; the save boundary now reduces them, the way the
  main process does on write, and existing arrays pass through so the optional
  `active` flag survives.

## [0.10.2] — 2026-09-16

### Added

- **Windows MSI installer.** The `msi` target was configured but the release
  workflow overrode it with an explicit `nsis`-only build, so no `.msi` ever
  shipped. The Windows build now produces both installers and the release
  checklist requires the `.msi` asset.

## [0.10.1] — 2026-09-14

### Fixed

- **Cloud sync "Keep local" conflict loop.** Resolving a push-detected
  conflict with Keep Local asked the server to apply the local copy, then
  discarded the server's `resultingRev` and re-enqueued the same payload at
  the superseded `cloud_rev`. The next push returned `CONFLICT` with the
  user's own payload as the cloud winner ("No structural differences"),
  looping forever. Resolution now converges to the server-returned revision
  (`convergeServerKeepLocal`), writes the winning copy when the local record
  is a tombstone or missing, and re-pushes only genuinely newer queued edits.
- **Canvas toolbar clipping.** The toolbar picked its density from hard-coded
  width thresholds that no longer matched the button set, so Run could hang
  off the edge at widths that still passed the labels tier. It now resets to
  labels on width change and steps down tiers by measuring
  `scrollWidth > clientWidth` in a layout effect before paint.
- **Blurry node text on zoom.** The scrollable node textarea wrapper stayed a
  scroll container (`overflow: auto`), promoting it to its own composited
  layer that the compositor resampled under the canvas zoom transform. The
  wrapper now uses `overflow: clip` at rest (no composited layer) and becomes
  a real scroller only on `focus-within`, preserving caret, wheel, and resize
  behavior while editing.

## [0.10.0] — 2026-09-11

### Added

- **SSE Stream node.** A bounded Server-Sent Events listener for contract
  tests. Its **Ready** output fires once the handshake succeeds, so a
  downstream trigger cannot race the subscription; **Complete** fires with the
  collected events after an event cap, a matching finish trigger, a timeout or
  cancellation.
- **Right-click to add a node.** The canvas context menu is now the node
  palette anchored at the cursor, with search, saved presets and imported
  OpenAPI groups. A clicked or Enter-selected node lands at the cursor.
- A workflow can have more than one End node.

### Changed

- **Leaner MCP bridge for edit-and-debug loops.** The tool catalogue shrank
  from about 528 KB to 300 KB across 54 tools, seven superseded tools were
  removed, and new focused reads and a debug context replace whole-workflow
  dumps. Patch schemas are strict, so an unknown key is rejected.
- The conflict merge view is a three-pane layout with per-field accept and
  reset controls.
- Call Workflow nodes show the target workflow's name instead of its id.

### Fixed

- Cloud sync heals a missing cached config on the next launch instead of
  stopping with "not linked to any workspace", and a paused sync shows a
  readable reason.
- MCP previews truncate on UTF-8 boundaries and no longer overrun their byte
  budget; debug context no longer reports unreached End nodes and untaken
  branches as blocked.
- Run creation over MCP survives a deleted idempotency replay target.

## [0.9.1] — 2026-09-08

### Added

- **End-to-end encryption for Cloud workspaces.** A Cloud workspace can be
  encrypted with a passphrase, so the server stores only ciphertext.
- **Cloud attention.** Locked workspaces, conflicts, encryption choices, sync
  errors and expired sign-ins are surfaced in one banner, on the account menu
  and in the workspace switcher. A workflow with an unresolved conflict shows a
  banner on its canvas.
- **Opening prompt for agents.** The agent launch menu takes a prompt that is
  sent to the agent it starts. Agent sessions show their start time, and the
  stdin prompt mode can be chosen in agent settings.
- The update banner also announces available and downloading updates.

### Fixed

- The unlock dialog no longer blames a wrong passphrase for a network,
  sign-in or access problem, and names a passphrase rotation by an admin as a
  possible cause.
- A record that is still sealed is never written to local tables.
- The login-shell PATH merge no longer collapses PATH on Windows test runs.

## [0.9.0] — 2026-09-04

### Added

- **Group frames and notes.** Frames group nodes on the canvas and move them
  together; notes hold free text. Neither runs, and both round-trip through
  export and Cloud sync.
- **Undo and redo** for canvas edits.
- **Command palette and focus mode.** Search actions and nodes from the
  keyboard, and step through a workflow's nodes one at a time.
- **Canvas navigation.** Drag modes, camera lock, snap to grid, a pane
  overview and per-node focus.
- **Partial MCP edits.** `workflows_patch` merges node fields instead of
  replacing the node, `workflows_get` can return a subset of nodes, and node
  results can be read while a run is still going. Unknown dynamic functions
  are flagged before a run.

### Changed

- The canvas moved from React Flow 11 to React Flow 12 (`@xyflow/react`).
- A warmer light theme, and node chrome that shows each node's kind on a cap.
- Each node renders inside its own error boundary, so one broken node no
  longer blanks the canvas.
- Periodic background work pauses while the window is hidden.

### Fixed

- Text no longer blurs while the canvas camera moves.
- Auto-layout reads each node's measured size, and lays framed nodes out
  inside their frame.
- Swagger refresh caches are bounded.

## [0.8.6] — 2026-08-31

### Added

- **Duplicate and move for environments and secrets.** Environments can be
  duplicated (copy without secrets or default flag, dangling cross-workspace
  base links dropped) or moved to another workspace (re-homes the row, clears
  dangling workflow `selectedEnvironmentId` / sibling `baseEnvironmentId`
  references and the default flag, and reassigns scoped secrets so they are not
  orphaned by cascade delete). Secrets can be duplicated or moved across scopes
  with sealed ciphertext carried without ever exposing plaintext; deliberately
  excluded from the MCP surface alongside `set`/`delete`. The workspace pages
  now group environments and secrets by owning workspace with duplicate/move
  dialogs and warnings about what gets cleared. Also fixes an
  `EnvironmentStore` / `ScopedSecretList` race where a slow response for an
  abandoned workspace could clobber the current list.

- **Agent-driven runs and writes visible in the renderer.** A run started over
  MCP was invisible: now a `apiweave:run-started` broadcast (with workflow
  identity) lets any open canvas adopt a matching run and stream it exactly like
  one of its own, including camera follow; on mount it also picks up a run
  already in flight. A companion `apiweave:agent-write` fact (`{domain, action,
  workspaceId?}`) emitted from the MCP bridge triggers a refresh of workspace,
  project, environment and node-preset lists instead of waiting for window
  focus. Deleting a workspace over MCP or via cloud tombstone now correctly
  removes its workflows from any open canvas and no longer throws
  `FOREIGN KEY constraint failed` on `cloud_record_state` writes.

### Fixed

- **Beautify button no longer minifies.** `BeautifyButton` toggled between
  format/minify on a flaky indentation heuristic, collapsing the body back to
  one line on the second click; now it is format-only (`tryFormatJson`), the
  unused `tryMinifyJson`/`formatOrMinifyJson`/`isBeautified` helpers are
  removed, the JSON body auto-formats when opening the panel or switching body
  type to JSON so bodies imported via cURL/HAR/Postman/MCP display readably,
  and the Monaco editor chunk is warmed on mount in parallel with its config.

## [0.8.5] — 2026-08-27

### Fixed

- **Sync variable redaction kept the key.** `sanitizeVariables()` dropped a
  workflow/environment variable entirely when its name looked sensitive
  (`token`, `apiKey`, `password`, …) instead of keeping the key and blanking
  just the value like every other sensitive field. A variable named `token`
  holding a credential vanished from the cloud payload, breaking
  `{{variables.token}}` references on the next pull (including the same device
  after logout/login). Now the key survives with the value blanked — or
  preserved verbatim if it is a credential-free `{{...}}` reference — matching
  the header/cookie contract.

## [0.8.4] — 2026-08-27

### Fixed

- **Secret withholding on export preserves variable refs.** Auth leaves that
  carried a `{{variables.*}}` reference alongside a secret-shaped key were
  incorrectly blanked on `.awecollection` export and sync. The shared redaction
  walk now preserves `{{...}}` references in auth leaves. Also tightens leaf
  detection so credentials smuggled alongside a reference are still caught.

## [0.8.3] — 2026-08-27

### Fixed

- **Agent roster missing/stale on Linux and macOS.** A GUI-launched app does
  not inherit the user's shell PATH, so the Agents roster's `--version` probes
  ran against whatever a `.desktop` entry or Finder launch happened to hand
  the process — reporting an installed CLI (e.g. Claude Code in `~/.local/bin`)
  as not-found, and resolving another (e.g. `opencode`) to a stale copy earlier
  system directories instead of the newer one on the user's real PATH. The app
  now runs the user's login shell once at startup (`$SHELL -ilc 'env'`, with a
  `passwd`-entry fallback when `SHELL` is unset, as on a Finder launch) and
  merges its PATH into the process's before any agent detection, embedded PTY
  launch, or external-terminal launch resolves an executable.

## [0.8.2] — 2026-08-27

### Added

- **Daily log files.** Main-process and renderer output goes to one
  structured log file per day instead of the console.
- **MCP auto-layout.** Graph writes over MCP lay out the nodes they add, and a
  `workflows_layout` tool lays out a whole workflow.

### Changed

- App-wide settings open as routed pages instead of modals.

### Fixed

- The run camera follows the nearer branch at a fan-out instead of the first
  one to report.
- The `environments_setVariable` tool description says which namespace it
  writes and points at the secrets tools.

## [0.8.1] — 2026-08-23

### Fixed

- Packaged builds failed to load the database: better-sqlite3 is rebuilt for
  Electron before packaging.

## [0.8.0] — 2026-08-23

### Added

- **Embedded agents.** Launch a local coding agent (Claude Code, Codex,
  OpenCode, Gemini and others) attached to a workflow or project, in a
  terminal docked in the app or in an external terminal. Sessions run in a
  separate PTY host process, survive a window reload, show whether the agent
  is working or idle, and can be resumed after they finish. Each agent is
  briefed on the workflow it is attached to and wired to the MCP bridge.
- **Live updates from agent writes.** A workflow an agent changes over MCP
  refreshes on the open canvas.
- **Move workflows and projects between workspaces.**
- Swagger UI pages that list several API definitions can be imported.
- The Windows installer is also published as a `.zip` for manual download.

### Changed

- The canvas toolbar adapts to its own width instead of the window's.
- Cloud conflict resolution defers the push until you confirm, with a revised
  merge view.

### Fixed

- The last selected workspace is remembered across restarts, and open tabs
  are scoped to their workspace.
- Toasts can be closed: the close button sat under the window drag region.
- A stale default environment id from local storage no longer breaks a run.
- Autosave no longer fires right after a workflow loads.
- Minimap display glitches.

## [0.7.8] — 2026-08-14

### Added

- **Run camera.** While a run executes, the canvas camera follows the active
  branch with a physics-based tracker (attention focus plus damped spring) that
  tracks one run front at a time. Any manual zoom, pan, or fit-view suspends the
  follow immediately; a **Follow run** pill on the canvas hands control back.
  The minimap freezes while the camera is in motion and unfreezes the moment you
  take over.
- **Expected status on HTTP Request.** A per-node `expectedStatus` (one code or
  a comma-separated list, e.g. `409` or `409, 422`) fully replaces the default
  2xx-passes rule, turning the request itself into a negative test: a match
  passes (a matched 409 renders green with its status text), anything else —
  even a 2xx — fails. The expected status is echoed on transport errors and
  persisted in run results. The analyzer suggests this control over the
  `continueOnFail`-plus-status-assertion pattern
  (`continue_on_fail_status_check_migratable`), and a new
  `assertion_fail_wired_on_all` notice flags assertion `fail` handles that all
  land on `end` (same behavior as leaving them unconnected).
- **Private networks opt-in.** A new **Settings → Private networks** toggle
  (off by default) lifts the SSRF block on RFC1918/unique-local hosts (`10/8`,
  `172.16/12`, `192.168/16`, `fc00::/7`) for HTTP request nodes and URL imports
  through the one shared `SafeHttp` instance; link-local, metadata, and
  multicast addresses stay blocked either way. The choice is persisted under
  `app_settings` (`http.allow_private_networks`) through new
  `settings.get` / `settings.setPrivateNetworks` handlers, and takes effect
  immediately.
- **Sync failure visibility.** `cloud.listFailedRecords` plus an in-app Failed
  Records dialog surface dead-lettered sync records; rejected IPC dispatches are
  logged to `main.log`; the real server rejection reason reaches save toasts
  instead of a generic failure.

### Fixed

- **Workflow last run disappearing.** Opening a node's editor after a run no
  longer drops the last run's results from the canvas.
- **Sync credential redaction.** Push, pull, and export now share one redaction
  contract: request bodies and headers sync with leaf-level credential
  redaction (secret-shaped leaves blanked, `{{...}}` references preserved),
  cookie values are always withheld, URLs are stripped of credentials, and a
  fail-closed `assertNoSecretValues` pass runs on every outgoing payload.
  `.awecollection` export redacts bundle bodies leaf-by-leaf with the same walk.

### Security

- The renderer CSP now pins `wasm-unsafe-eval`, closing a vector on the
  packaged renderer.

## [0.7.7] — 2026-08-13

### Added

- **Expected status on HTTP Request nodes** and the
  `assertion_fail_wired_on_all` analyzer notice (both described under 0.7.8).
- MCP authoring improvements: run results list each node's unresolved
  placeholders, `runs_getNodeResult` returns node-level diagnostics, and write
  tools take a `return` option (`summary`, `diagnosis` or `full`).

### Changed

- The window title bar is merged into the app header.

### Fixed

- The analyzer diagnoses a failure from the runner's verdict, not the raw
  status code.

## [0.7.6] — 2026-08-09

### Fixed

- The account menu crashed when the avatar URL was missing, and showed a
  rectangular avatar.

## [0.7.5] — 2026-08-09

### Added

- **Store response values as variables** by picking them in the response
  tree of an HTTP Request node.
- Workflow authoring over MCP is discoverable and can be verified by the
  agent.

### Changed

- Side-panel tips open as an on-demand sheet instead of a footer.

### Fixed

- Start and End nodes and branch edges are painted with the run status.
- Switching Cloud accounts scopes the workspace list to the new account.

## [0.7.0] — 2026-08-06

### Added

- **Auto-update** from GitHub Releases on a pinned update channel, under the
  policy chosen in **Settings → Updates** (notify by default; automatic only
  where the platform can self-install), with staged rollouts and a kill switch
  for bad releases.
- The app icon is set for the installer, taskbar and Start menu.

### Fixed

- Update errors are shown as a short message instead of a raw error dump.

## Current — local-first desktop

APIWeave is a single-process Electron app. The renderer is the ReactFlow canvas;
the Electron main process owns the IPC handler registry, the workflow executor,
the SQLite store, the encrypted secret store, and the local MCP bridge. There is
no separate backend, worker, or database server, and no Docker stack to run.

### Added

- **Local-first single process.** Workflows, projects, environments, runs, and
  secrets live in a single SQLite database file under the OS user data
  directory. No account is required to use the app.
- **Visual workflow canvas.** ReactFlow canvas with drag and drop, 700ms
  debounced auto-save, adaptive polling, copy and paste of nodes, and persistent
  node templates. A **Save** toolbar button and the `Ctrl+S` shortcut flush the
  workflow to disk immediately, bypassing the debounce; auto-save still runs in
  the background.
- **Seven node types.** HTTP Request, Assertion, Delay, Merge, Call Workflow,
  Start, and End.
- **Call Workflow node.** Runs another workflow in the same workspace inline as
  one step, mapping caller variables in and the sub-workflow's variables back
  out. The sub-workflow shares the run's environment and secrets, so only
  `{{variables.*}}` need mapping, and a `{{secrets.*}}` reference in an input
  mapping is refused rather than copied into a plain child variable. Execution
  is inline: no child run row and no new run-history surface, with the calling
  node's result carrying the sub-workflow summary. A cross-workspace target or a
  direct self-call is rejected on save; nesting is capped at 8 levels so a cycle
  created by editing a target later fails the node cleanly instead of hanging.
- **Node presets.** A workspace-scoped library of saved node configurations
  (`node_presets` table, `nodePresets.*` IPC domain, `nodePresets_*` MCP tools).
  Save any configurable node from its `⋯` menu, then drag it onto any canvas in
  the workspace; rename and delete from the palette. Configs are canonicalised
  and validated against the node type on write. Presets are local-only — there
  is no sync record type for them, so they never leave the machine.
- **Workflow variables and extractors.** JSONPath extractors pull values from a
  response into workflow variables; four placeholder namespaces plus dynamic
  functions resolve values before a request goes out.
- **Projects.** Ordered groups of workflows with a per-workflow `continueOnFail`
  flag and a color tag. Projects export as `.awecollection` bundles that carry
  references only — never secret values, ciphertext, or per-scope private keys.
  A workflow belongs to at most one project at a time, or to none.
- **Environments.** Named bundles of variables that you select for a run. The
  effective environment feeds `{{env.*}}` and is the narrowest scope the runner
  checks for `{{secrets.*}}`. The header's **Default environment** selector is a
  per-machine convenience preference that preselects the environment for new
  workflows; each workflow keeps its own selection.
- **Environment inheritance.** An environment can extend a base environment in
  the same workspace (`baseEnvironmentId`), and the run resolves the chain
  base-first with each descendant overriding the names it redefines. Plain
  variables only — the `environment > workspace` secret scope chain is
  unchanged and secrets are never inherited. Self-reference, cross-workspace
  bases, and cycles are rejected, and chains are bounded at 8 levels. The base
  link is not yet part of the Cloud sync payload, so it stays on this machine.
- **Encrypted secret store.** Libsodium sealed-box write-only ingress against a
  single per-install keypair; the sealed ciphertext is stored verbatim and
  opened at run time with the key derived from the per-install keyfile. The
  `{{secrets.NAME}}` placeholder resolves through a local scope
  chain: the selected environment wins, then the workspace store
  (`environment > workspace`). The metadata-only display shows name, scope, key id,
  and last update time — never the value or ciphertext. There is no read API
  for stored secret values reachable by a user, IPC handler, or MCP tool.
- **In-process runner.** The `RunScheduler` claims pending runs, the
  `WorkflowExecutor` walks the node graph, `safe_http` makes outbound HTTP
  calls with SSRF guards, and `dynamic_functions` evaluates placeholder
  functions. Progress streams to the renderer over IPC; no polling. Large
  response payloads live in a separate blob table. A node that two paths
  converge on is entered once: the second arrival joins the first instead of
  re-sending the request and re-walking the subtree behind it.
- **Resume groundwork.** Run records carry `resumeFromRunId` / `resumeFromNodeIds`
  lineage links and the executor supports starting from chosen node ids, but the
  resume UI is not exposed in this release: **Run** always executes the full
  workflow from Start.
- **Local MCP bridge.** An opt-in loopback HTTP server at `127.0.0.1:<port>`
  exposes the IPC handler registry as a second transport so local AI agents on
  the same machine can drive the app. It uses a static per-install token and is
  off by default. No remote trigger, no webhook, no public port.
- **Import.** OpenAPI 3.x, Swagger 2.0, HAR, and cURL import.
- **Optional APIWeave Cloud sync.** An optional Cloud account enables two-way
  sync of test structure (workflows, environments, projects, and secret
  references) and collaboration in shared Cloud Workspaces (owned by a Cloud
  Team) across machines. The desktop app is fully usable
  without a Cloud account. Cloud never builds or runs tests, never stores run
  history, and rejects `secrets` and `runs` fields on sync and conflict paths.
- **Cloud conflict resolution.** When a local and a Cloud copy diverge, the
  conflict list shows a semantic diff per field, detection time, and the
  author of the Cloud-side change. Resolutions cover keep-local, take-remote,
  and field-level picking; mergeable conflicts auto-merge, and conflicts
  resolved on another machine are reconciled on the next sync.
- **Team-aware workspace switching.** The workspace switcher labels every
  workspace with its source (Personal workspace, Personal Cloud space,
  Team · <Team name>, On this device) so duplicate names stay distinguishable.
  The creation dialog offers Personal or Team ownership, consults the
  server-authoritative `canCreateWorkspaces` capability, and creates Team-owned
  Cloud Workspaces from the desktop.
- **Run event broker.** Run lifecycle events stream through a broker, and MCP
  clients can subscribe to resources over the bridge instead of polling.
- **Rebuilt assertion engine.** Assertions resolve the upstream HTTP result
  through graph predecessors, persist structured value-free evidence for every
  configured rule (including rules skipped by `failureMode: "first"`), support
  header and cookie sources, expected-value templates with secret references,
  and canonical JSON comparison semantics.
- **MCP safety hardening.** Streamable HTTP requests are origin-validated
  against DNS rebinding, every tool carries intent annotations (read-only,
  destructive, idempotent, open-world) plus output schemas and structured
  content, and run projections redact bodies, headers, cookies, URLs, variable
  values, raw errors, and assertion actual values.
- **Run playback on the canvas.** The canvas plays a run back rather than
  mirroring it. Status events queue in the runner's order and release under two
  rules: a node cannot light up until the traversal into it has landed, and a
  node that lights up holds that state for a minimum dwell. Playback trails the
  run and compresses its tempo as the backlog builds, so a workflow of fast
  responses reads as a sequence instead of arriving in one frame. The toolbar
  and the end-of-run hydration wait for playback to settle, and hydration
  ignores a result that a newer run has superseded. The camera now follows the
  active branch during a run (see [0.7.8](#078--2026-08-14)); any manual zoom or
  pan takes over immediately.
- **Node and edge visual language.** All seven node types share one shell that
  carries idle, running, passed, failed, and skipped state. Edges are bezier
  paths that take their state from the node they leave, with a single
  GPU-composited dot travelling an active edge instead of a marching dash across
  the SVG layer; nothing on the canvas animates while no run is executing.
  Connection handles are 8px sockets inside a 20px hit area, and deleting an
  edge is keyboard-reachable. Both themes are held to WCAG contrast floors by
  test: light mode expresses state as a tighter coloured ring plus a body tint
  where dark mode uses luminance.
- **Keyboard shortcuts and dark mode.** `Ctrl+N`, `Ctrl+S` (flush to disk now;
  auto-save still runs), `Ctrl+R`/`F5` (run), `Ctrl+J` (JSON editor), plus
  context-aware copy and paste.

### Fixed

- **Arch (`.pacman`) install.** The pacman package's dependency list carried a
  Debian-only package name (`http-parser`) that has no Arch equivalent,
  which made `pacman -U` refuse the install with an unresolvable-dependency
  error. The pacman target now declares its own `depends` (`gtk3`, `nss`,
  `libxss`, `libxtst`, `at-spi2-core`) instead of inheriting electron-builder's
  Debian-oriented default list.

### Security

- Secrets are write-only at every layer. Plaintext secret values are never
  accepted on a write path and can never be read back through any UI, IPC
  handler, or MCP tool.
- The masking layer scrubs every resolved secret value before persistence, so
  run history never holds plaintext.
- The MCP bridge is loopback-only and token-gated; the token is treated like a
  private key.
- Secret values and run history are never synchronized to Cloud.

## Retired surface

The earlier self-hostable web application was retired and its stack removed.
The following, present in earlier builds, are gone and not coming back to the
desktop app:

- The Python backend, FastAPI, Beanie, Motor, and the separate worker.
- MongoDB and GridFS storage.
- The Docker Compose self-hosting stack.
- Webhooks, HMAC webhook execution, and remote triggers.
- The multi-tenant organization/workspace/member model, outside collaborators,
  invites, and the append-only audit log.
- Scoped service tokens, environment protection with required reviewers, and
  the trusted-token bypass.
- OAuth/OIDC and SSO login on the desktop side.
- APIWeave Cloud (removed in 0.20.0): the Cloud account and sync, shared Team
  workspaces, devices and roles. A workspace syncs through a git repository
  instead.
- The `SECRET_ENCRYPTION_KEY` server env var, per-instance DEK/KEK envelope
  model, and the `environment > workspace > organization` secret scope chain.
  The desktop uses a per-install keyfile and the `environment > workspace` local
  scope chain.
- `runtime_secrets` ad-hoc run-time secret input. Every secret must exist in the
  local store at the right scope before a run starts.
- The global `Environment.isActive` flag. The single global "one active
  environment" model is gone, replaced by a per-machine default-environment
  preference (the header selector) plus a per-workflow selection that overrides
  the preference for that run.
- The flat `/api/environments`, `/api/collections`, `/api/workflows`,
  `/api/webhooks`, and `/api/runs` HTTP paths and the
  `/api/orgs/{orgSlug}/...` scoped paths. The desktop renderer talks to the
  main process over a typed IPC channel; it does not call a separate HTTP
  backend.

Migration from the retired web surface to the local-first desktop app is a
clean install. There is no automatic upgrade path from the retired stack. See
[Installation](docs/getting-started/installation.md) and
[Architecture](docs/reference/architecture.md) for the current product.

[1.0.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v1.0.0
[0.22.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.22.0
[0.21.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.21.0
[0.20.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.20.0
[0.12.1]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.12.1
[0.12.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.12.0
[0.11.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.11.0
[0.10.2]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.10.2
[0.10.1]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.10.1
[0.10.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.10.0
[0.9.1]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.9.1
[0.9.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.9.0
[0.8.6]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.6
[0.8.5]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.5
[0.8.4]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.4
[0.8.3]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.3
[0.8.2]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.2
[0.8.1]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.1
[0.8.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.8.0
[0.7.8]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.8
[0.7.7]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.7
[0.7.6]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.6
[0.7.5]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.5
[0.7.0]: https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.0
