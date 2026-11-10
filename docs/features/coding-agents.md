# Coding Agents

*Run a coding-agent CLI you already have installed (Claude Code, Codex CLI, Gemini CLI, OpenCode and others) beside the canvas, already connected to APIWeave's MCP server and told which workflow it is working on. For anyone who wants an agent to build or fix workflows while they watch the canvas.*

## Prerequisites

- The APIWeave desktop app. Agents run as local processes, so they are not available anywhere else.
- At least one supported agent CLI installed and signed in on this machine. APIWeave launches the CLI under your own account; it never proxies, bundles or signs you in to any of them.
- For the agent to read and change workflows: the MCP server turned on in **Settings → MCP Server** (**Enable local MCP server**). See [MCP Integration](mcp-integration.md). Without it an agent still launches, but it is told it has no workflow tools.

## Table of Contents

- [Built-in Agents](#built-in-agents)
- [Settings → Agents](#settings--agents)
- [Launch an Agent](#launch-an-agent)
- [The Agent Dock](#the-agent-dock)
- [Busy and Idle](#busy-and-idle)
- [Resume a Session](#resume-a-session)
- [What the Agent Is Told](#what-the-agent-is-told)
- [Open in Your Own Terminal](#open-in-your-own-terminal)
- [Scratch Files](#scratch-files)
- [Keep Running in the Background](#keep-running-in-the-background)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Built-in Agents

The roster ships with ten agents. What each one gets depends on what its CLI can accept per launch:

| Agent | Command | MCP server wired | Session briefing | Resume |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | Yes | Yes | Yes |
| Codex CLI | `codex` | Yes | No | Yes, once it has printed its session id |
| Gemini CLI | `gemini` | Yes | No | Yes |
| OpenCode | `opencode` | Yes | Yes | Yes, once it has printed its session id |
| Cursor Agent | `cursor-agent` | No | No | No |
| Aider | `aider` | No (no MCP client) | Yes | No |
| GitHub Copilot CLI | `copilot` | Yes | No | Yes |
| Qwen Code | `qwen` | Yes | No | Yes |
| Crush | `crush` | No | No | Yes, once it has printed its session id |
| Pi | `pi` | No (no built-in MCP) | Yes | Yes |

An agent marked **No** in a column has no way to accept that piece without APIWeave writing into your repository or into a configuration file shared by every session on the machine, and APIWeave does neither. For those agents, add the MCP server yourself with the templates in [MCP Integration](mcp-integration.md).

## Settings → Agents

Open **Settings → Agents** to see the roster. Each row carries a status badge:

| Badge | Meaning |
| --- | --- |
| **Ready** | The command was found on `PATH` and `<command> --version` succeeded. It can be launched. |
| **Not installed** | The command is not on `PATH`. The row offers **Install**, which opens the CLI's own install page. |
| **Broken** | The command was found but `--version` failed. The error is shown in full under the agent's name. |
| **Unsupported** | The agent does not run on this operating system. |

The actions on the page:

- **Refresh** probes every agent again, after you install or fix one.
- The star (**Make default**) picks the agent the launch button starts. Only a ready agent can be the default.
- The pencil (**Edit**) changes an agent's command, arguments, opening-prompt mode, MCP config arguments and environment. Editing a built-in agent stores an override, for example to point `claude` at a wrapper script; **Reset to default** discards it.
- **Add custom agent** defines a CLI that is not in the roster:

```text
Key                    my-agent
Display name           My Agent
Command                my-agent          (the binary looked for on PATH)
Arguments              --verbose         (space separated, no shell involved)
Opening prompt         As positional argument
MCP config arguments   --mcp-config {path}
Environment            FOO=bar           (one KEY=VALUE per line)
```

A custom agent starts without a session briefing or Resume, because those flags differ for every CLI.

On Linux and macOS, an app started from the desktop or the Finder does not inherit your shell's `PATH`. At startup APIWeave asks your login shell for it, so an agent installed under `~/.local/bin`, nvm, Homebrew or similar is found. See [Environment Variables](../reference/environment-variables.md#read-from-the-host).

## Launch an Agent

An agent starts in a folder on disk: usually your API's source code, so it can read what the API under test does.

1. Open a workflow. The canvas toolbar shows **Set folder** until the workflow or its project has a folder. Click it and pick the folder.
2. The button now shows the default agent's name. Click it to start that agent in the dock beside the canvas.
3. For more choices, open the arrow beside it (**Agent options**):

```text
Folder — inherited from project
C:\src\shop-api
[ Task for the agent (optional) ]
  Claude Code
  Codex CLI
  ─────────────
  Open in my terminal
  Change folder…
  Clear folder
```

- **Task for the agent** is an optional opening prompt. Press Enter to start the default agent with it, or pick an agent from the list.
- A workflow uses its project's folder unless it has its own (**Folder — inherited from project**). **Clear folder** removes the folder set at this level.

You can also launch from a project: its agent button in **Projects**, or the agent icon on a project row in the sidebar. Those launches open in your own terminal, because the dock belongs to the workflow view.

## The Agent Dock

An agent launched from the canvas toolbar opens in the dock, a column between the sidebar and the canvas, so you can watch the canvas change as the agent edits the workflow. The dock's header shows the agent, its status badge, the title the agent gave the conversation (when it sets one) and the folder it runs in.

- **Stop this session** ends the agent's process.
- **Close the terminal** hides the dock. A live session keeps running.
- Type into the terminal as you would any terminal. A finished session reopens read-only, with its output.

The **Agents** entry in the left navigation rail lists every session in the workspace, live sessions first, then the most recent. Select one to open it in the dock. **Remove this session from the list** deletes APIWeave's record of it; the agent's own conversation history is untouched.

Agent processes run in a separate helper process, so reloading the window does not end them. Quitting APIWeave stops every embedded session.

## Busy and Idle

The status badge says what a session is doing:

| Badge | Meaning |
| --- | --- |
| `starting` | The process is starting. |
| `running` (spinner) | The agent is producing output now. |
| `idle` (still dot) | The process is alive and the agent has printed nothing for about a second and a half: it is usually waiting for you. |
| `exited` | The process ended with exit code 0. |
| `exit N` | The process ended with exit code `N`. |
| `failed` | The process could not be started. |
| `detached` | The session was opened in your own terminal, so APIWeave no longer follows it. |

The spinner only turns while output is arriving, so a row that spins is an agent that is working.

## Resume a Session

When a session has ended and its agent supports it, the dock shows **Resume this session**. It reopens the same conversation in a new process, in the same row, so the list holds one row per conversation rather than one per run.

Resume depends on knowing the agent's own id for the conversation:

- **Claude Code, Gemini CLI, GitHub Copilot CLI, Qwen Code and Pi** accept an id at launch, so APIWeave assigns one and every session is resumable, even one that crashed during startup.
- **Codex CLI, OpenCode and Crush** cannot be given an id; APIWeave reads it from their output, which they usually print as they exit. A session killed before printing it cannot be resumed.
- **Cursor Agent and Aider** never offer Resume. Cursor's interactive mode prints no id, and Aider has no session ids at all (it resumes per directory).

## What the Agent Is Told

An agent learns what it is attached to before you type anything, so you do not have to explain it every session:

- **Every agent wired to the MCP server** receives the server's standing instructions when it connects: what APIWeave is and which guides to read.
- **Agents with a session briefing** (Claude Code, OpenCode, Aider, Pi) also get a short briefing naming the workflow or project, the workspace and the folder, and stating that the workflow lives in APIWeave's database rather than in the folder.
- **Every launched agent** gets the same ids in its environment: `APIWEAVE_WORKSPACE_ID`, plus `APIWEAVE_WORKFLOW_ID` or `APIWEAVE_PROJECT_ID`. See [Environment Variables](../reference/environment-variables.md#set-for-launched-agents).

The briefing for an agent launched on a workflow reads like this (abridged):

```text
# APIWeave session briefing

## What this session is attached to

- Workflow: "Create order" (wf_01J…)
- Workspace: ws_01J…
- Folder you are running in: C:\src\shop-api

## The workflow is not in this folder

It lives in APIWeave's own database. The `apiweave` MCP server is already
connected to this session, and it is the only way to read or change one.
```

When the MCP server is off, the briefing says the workflow tools are absent instead, so the agent tells you rather than editing files.

## Open in Your Own Terminal

**Open in my terminal** in the launch menu starts the default agent in your terminal emulator instead of the dock, for work that should outlive the APIWeave window. It is also what project launches use. The session is marked `detached`, and **Stop** is not offered: the process belongs to that terminal.

APIWeave picks the emulator in this order:

- **Windows**: Windows Terminal, WezTerm or Alacritty, whichever is installed (the one named by `%TERMINAL%` or `%TERM_PROGRAM%` first), then a plain console window.
- **Linux and macOS**: the emulator named by `$TERMINAL`, otherwise the one that started APIWeave (`$TERM_PROGRAM`), then the emulators it knows for the platform.

An opening prompt is passed to an external launch as an argument; an agent configured to take its prompt **Typed into the terminal** cannot take one externally, and the launch says so.

## Scratch Files

To connect an agent and brief it, APIWeave writes small per-session files: the MCP config (which holds the server's bearer token), the briefing, and on Linux and macOS a launcher script for external terminals. They live in the `agent-files` folder of APIWeave's user data folder, never in your repository:

```text
Windows   %APPDATA%\APIWeave\agent-files\
macOS     ~/Library/Application Support/APIWeave/agent-files/
Linux     ~/.config/APIWeave/agent-files/
```

Each file is deleted when its session ends, and any left behind by a crash are removed the next time APIWeave starts.

## Keep Running in the Background

**Settings → Background** keeps APIWeave available to agents when its window is closed:

- **Keep running in the tray**: closing the window hides it to the system tray instead of quitting, so the MCP server and git sync stay reachable. Quit from the tray menu (**Quit APIWeave**).
- **Open at login**: start APIWeave hidden in the tray when you sign in. On Windows and macOS this is the system's own login item. On Linux it writes an XDG autostart entry, `~/.config/autostart/apiweave.desktop` (or under `$XDG_CONFIG_HOME`), which GNOME, KDE, XFCE, Cinnamon and systemd's autostart generator honour. A compositor that reads none of them, such as Hyprland or Sway without uwsm, needs a line in its own config instead:

```text
exec-once = apiweave --hidden
```

Some Linux desktops (stock GNOME) show no tray icon. Launching APIWeave again brings the hidden window back.

## Troubleshooting

- **If an agent shows Not installed but works in your terminal**, its folder is not on the `PATH` APIWeave sees. On Linux and macOS, make sure your login shell's startup files add it, then restart APIWeave and click **Refresh**. On Windows, restart APIWeave after the installer changes `PATH`.
- **If an agent shows Broken**, read the error under its name; it is the CLI's own message. Run the same command in a terminal, fix it, then click **Refresh**.
- **If the launch button says No agent**, no agent in the roster is ready. Open **Settings → Agents**.
- **If the agent says it has no APIWeave tools**, turn on **Enable local MCP server** in **Settings → MCP Server** and launch a new session. For an agent with no MCP wiring (see the table above), add the server to its own config.
- **If Resume is not offered**, the agent does not support it, or (Codex CLI, OpenCode, Crush) the session ended before the agent printed its id. Start a new session.
- **If the terminal stays blank**, close the dock and open the session again from the **Agents** list.
- **If Open at login does nothing on Linux**, your session does not read XDG autostart. Add `exec-once = apiweave --hidden` (or your compositor's equivalent) to its config.

## Related

- [MCP Integration](mcp-integration.md): the server agents connect to, its tools and its security model.
- [Environment Variables](../reference/environment-variables.md): the variables APIWeave reads and the ones it sets for agents.
- [Known Limitations](../reference/known-limitations.md)
- [Projects](projects.md): projects and their folders.
