import type { TutorialChapter } from "../../types";

/**
 * Chapter 6 — Agents. Embedded coding-agent sessions and the local MCP bridge.
 */
export const agentsChapter: TutorialChapter = {
  id: "agents",
  title: "Agents",
  summary:
    "Run a coding agent beside the canvas, and let a local AI agent drive the app over MCP.",
  lessons: [
    {
      id: "embedded-agents",
      chapterId: "agents",
      title: "Embedded coding agents",
      summary:
        "The installed-CLI prerequisite, the roster, launching in a folder or workflow, the briefing, the dock, activity status, and stop/history/resume.",
      outcome:
        "You can launch a coding agent in the app, watch it work next to the workflow, and resume a finished conversation.",
      keywords: [
        "agent",
        "agents",
        "claude code",
        "codex",
        "terminal",
        "dock",
        "session",
        "resume",
        "briefing",
        "roster",
        "pty",
      ],
      durationMinutes: 7,
      prerequisites: [
        "At least one supported coding-agent CLI installed and authenticated on this machine.",
      ],
      steps: [
        {
          title: "Check the roster",
          instruction:
            "Open Settings → Agents. The panel lists built-in agents with an availability badge: Ready, Not installed, Broken or Unsupported.",
          detail:
            "Every agent is a CLI you install and authenticate yourself. APIWeave launches it under your credentials and never proxies or bundles access.",
        },
        {
          title: "Confirm a CLI is installed",
          instruction:
            "If an agent shows Not installed, install its CLI and authenticate it, then use the refresh action in the roster.",
          detail:
            "The roster's refresh re-probes availability; each row's install link opens the vendor's docs.",
        },
        {
          title: "Add a custom agent if needed",
          instruction:
            "Use Add in the roster to define a custom agent: a name, a detection command, argv, prompt mode, optional MCP args, and environment variables.",
          detail:
            "A custom definition is for a CLI the built-in table does not cover.",
        },
        {
          title: "Launch from a workflow or a folder",
          instruction:
            "Use the Agents button in the canvas toolbar to launch against the current workflow, or launch from the Projects list to work in the project folder.",
          detail:
            "A launch attaches the agent to a workflow and a folder so it does not start by grepping for a workflow that was never on disk.",
        },
        {
          title: "Read the briefing the agent receives",
          instruction:
            "Know that the agent is briefed by APIWeave before you type anything: the MCP server's instructions reach every agent, and a per-session briefing file carries the workflow, workspace and folder for CLIs that accept standing instructions.",
          detail:
            "Briefing and MCP config files are scratch: they are written per session outside your repository and deleted when the session reaches a terminal state.",
        },
        {
          title: "Work in the dock",
          instruction:
            "The terminal opens in the agent dock column beside the canvas. Type into it as you would a normal terminal, and keep editing the workflow alongside it.",
          detail:
            "The dock sits between the sidebar and the canvas, and only one terminal is mounted per session because a session's output port has exactly one holder.",
        },
        {
          title: "Read activity versus process status",
          instruction:
            "The status badge reports process facts: starting, running, exited or failed. A separate activity signal tells you whether the agent is busy producing output or waiting at its prompt.",
          detail:
            "A spinner is driven by the activity signal, not by status — a live session that is idle does not animate.",
        },
        {
          title: "Stop a session",
          instruction:
            "Use the stop control on a live session to end it. Remove a session row to tidy the list; removing does not delete the underlying CLI conversation.",
        },
        {
          title: "Resume a finished conversation",
          instruction:
            "When an agent supports resume, a finished session offers Resume. Resuming reuses the same row and moves its start time, because a row is a conversation rather than a single run.",
          detail:
            "Not every CLI offers resume; an agent with no verified resume flag simply never shows the action.",
        },
        {
          title: "Find past sessions",
          instruction:
            "Open the Agents section in the sidebar. Live sessions sort first, then the most recent; selecting one opens it in the dock.",
        },
      ],
      example: {
        caption: "Where each part lives",
        language: "text",
        code: "Settings -> Agents      configure the roster, add a custom agent\nCanvas toolbar Agents   launch against the current workflow\nProjects list           launch in the project folder\nSidebar -> Agents       every session, live first; select to open\nDock (beside canvas)    the terminal for the selected session",
      },
      expectedResult:
        "A launched agent starts in the dock with a briefing already in hand, reports whether it is busy or waiting, and can be stopped, removed, or resumed when its CLI supports it.",
      troubleshooting: [
        {
          title: "An agent shows Broken",
          instruction:
            "The CLI is installed but failed a probe. Confirm it runs in a terminal, then refresh availability.",
        },
        {
          title: "An agent shows Not installed",
          instruction:
            "The detection command is not on PATH. Install and authenticate the CLI, then refresh.",
        },
        {
          title: "Resume is not offered",
          instruction:
            "That CLI has no verified resume flag in the roster. Start a new session instead.",
        },
        {
          title: "The terminal is blank",
          instruction:
            "Only one terminal may hold a session's output port. Close a duplicate view of the same session and reopen it.",
        },
      ],
      relatedLessonIds: ["mcp", "settings", "projects"],
      destination: { label: "Configure agents", path: "agents" },
    },
    {
      id: "mcp",
      chapterId: "agents",
      title: "Drive APIWeave over MCP",
      summary:
        "Enable the local bridge, connect a client with the token, use tools, resources and prompts, and see agent writes and runs in the app.",
      outcome:
        "A local AI agent can create, run and inspect workflows through a loopback-only, token-gated MCP server.",
      keywords: [
        "mcp",
        "model context protocol",
        "agent",
        "bridge",
        "token",
        "tools",
        "resources",
        "prompts",
        "loopback",
        "claude",
        "cursor",
        "vs code",
        "opencode",
        "codex",
      ],
      durationMinutes: 8,
      prerequisites: [
        "An MCP client on the same machine, such as Claude Desktop, Cursor, VS Code, OpenCode or Codex.",
      ],
      steps: [
        {
          title: "Enable the bridge",
          instruction:
            "Open Settings → MCP Server and turn on Enable local MCP server. The app binds a loopback HTTP server on 127.0.0.1 and writes a per-install token.",
          detail:
            "It prefers port 47271 and picks a free loopback port if that one is taken. Off by default; nothing listens until you enable it.",
        },
        {
          title: "Copy the connection details",
          instruction:
            "Copy the live URL and token from the MCP panel. It also offers a ready-made client config and an npx mcp-remote bridge command for stdio-only clients.",
        },
        {
          title: "Add the client configuration",
          instruction:
            "Paste the config into your MCP client, replacing the token with the real value, and restart or reconnect the client.",
          detail:
            "The transport is Streamable HTTP at /mcp with an Authorization: Bearer <token> header. Checked-in templates live under mcp-configs/.",
        },
        {
          title: "Verify the connection",
          instruction:
            "Call server_info from the client to confirm the bridge is reachable and to get the authoring-guide URIs.",
        },
        {
          title: "Discover the surface",
          instruction:
            "Use the client's standard tools/list, resources/list and prompts/list requests. Tool groups cover workspaces, workflows, assertions, projects, environments, node presets, runs, secrets and guides.",
          detail:
            "Do not rely on a fixed tool count; the surface evolves, so tools/list is the authoritative inventory.",
        },
        {
          title: "Read the authoring guides",
          instruction:
            "Have the agent read the apiweave://guide/start-here resource first, then workflow-authoring, placeholders, assertions, diagnostics and redaction.",
          detail:
            "The guides ship inside the desktop bundle, so they work without the docs folder, which is not packaged.",
        },
        {
          title: "Create and run a workflow",
          instruction:
            "Have the agent call workflows_search, then workflows_create or workflows_update, read the returned diagnosis, and then runs_create. Poll runs_get until the status is terminal.",
          detail:
            "Graph writes return a static diagnosis, so a missing edge handle or unaddressable assertion path is visible without firing a live request.",
        },
        {
          title: "Watch agent activity in the app",
          instruction:
            "Observe that an agent-started run appears on the canvas exactly like one you started, with nodes lighting up and the camera following. An agent write to another surface triggers a refetch of the affected list.",
          detail:
            "If the workflow is not the one on screen, the app raises a notice naming it rather than switching your canvas on its own.",
        },
        {
          title: "Know the security boundary",
          instruction:
            "Treat the token like a password. The bridge is loopback-only, requires the token on every request, and accepts browser-originated requests only from a loopback origin. It exposes many read and write tools, but never secret values and no secret write: secret reads return metadata only.",
          detail:
            "Run tools return metadata-only projections, except runs_getNodeResult, which returns one node's stored request/response after the standard secret redaction.",
        },
      ],
      example: {
        caption: "A minimal client configuration",
        language: "json",
        code: "{\n  \"mcpServers\": {\n    \"apiweave\": {\n      \"type\": \"http\",\n      \"url\": \"http://127.0.0.1:47271/mcp\",\n      \"headers\": { \"Authorization\": \"Bearer YOUR_MCP_TOKEN\" }\n    }\n  }\n}",
      },
      expectedResult:
        "The client lists APIWeave's tools and can create a workflow, run it, and read its metadata, while every change shows up live in the desktop app.",
      troubleshooting: [
        {
          title: "Connection refused",
          instruction:
            "APIWeave must be running and the bridge enabled. Copy the current URL from the MCP panel instead of assuming 47271.",
        },
        {
          title: "401 Unauthorized",
          instruction:
            "The bearer token is missing or stale. Update the client configuration with the token shown in the app.",
        },
        {
          title: "403 Forbidden Origin",
          instruction:
            "A browser or proxy supplied a non-loopback Origin. Connect through a native MCP client or a local stdio-to-HTTP adapter.",
        },
        {
          title: "A config value comes back as <SECRET>",
          instruction:
            "Intentional: structure is intact and the credential value is withheld. It is why an agent cannot re-apply an existing preset; drag it on the canvas in the app instead.",
        },
        {
          title: "No raw response body",
          instruction:
            "Run tools expose safe metadata only. Inspect the full body in the desktop UI, or call runs_getNodeResult for one node.",
        },
      ],
      relatedLessonIds: ["embedded-agents", "runs-history", "secrets", "settings"],
      destination: { label: "Configure the MCP server", path: "mcp-server" },
    },
  ],
};
