import type { AgentDefinition } from "../types/AgentDefinition"

/**
 * The built-in agent roster.
 *
 * Every entry is a CLI the *user* has installed and authenticated themselves —
 * APIWeave launches it under their own credentials and never proxies, bundles,
 * or re-sells access to any of them. That is also why the roster is a plain
 * data table: adding an agent is a row, not code.
 *
 * `mcpConfigArgs` is deliberately conservative. It is set only where the flags
 * have actually been confirmed against an installed CLI, because a wrong
 * template produces an agent that refuses to start with an unknown-flag error,
 * which is a much worse failure than simply not auto-wiring MCP. Agents left
 * at an empty array still launch in the right directory; their MCP config stays
 * a manual step via the templates in `mcp-configs/`.
 *
 * `resumeArgs` and its two companions follow the same rule, and for a sharper
 * reason: a wrong resume flag does not fail at the roster, it fails at the one
 * moment the user is trying to get a conversation back. Left empty, an agent
 * simply never offers Resume, which is a smaller loss than an offer that errors.
 *
 * `briefingArgs` is the same rule again, and the easiest of the three to leave
 * empty: an agent without it still learns what APIWeave is and which workflow it
 * is attached to from the MCP server's `instructions`. The flag only makes that
 * context standing rather than something the client may or may not surface.
 */
export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  {
    agentKey: "claude",
    name: "Claude Code",
    detectCmd: "claude",
    argv: [],
    expectedProcess: "claude",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    // Confirmed against CLI 2.1.226: `--mcp-config <path|json>` and
    // `--strict-mcp-config` (restricts the session to only the named servers).
    mcpConfigArgs: ["--mcp-config", "{path}", "--strict-mcp-config"],
    // Confirmed against CLI 2.1.233. The flag is absent from the top-level
    // `--help` list — it appears only inside another option's prose, as
    // `--append-system-prompt[-file]` — so it was checked the way an unknown
    // flag proves itself: `claude --append-system-prompt-file <path> mcp list`
    // runs, where `claude --bogus-flag mcp list` exits with "unknown option".
    // *Append*, not `--system-prompt`, which replaces Claude Code's own system
    // prompt and would leave the agent without its tool instructions.
    briefingArgs: ["--append-system-prompt-file", "{path}"],
    // Confirmed against CLI 2.1.233. `--session-id <uuid>` names the
    // conversation at launch — "must be a valid UUID", which is why the id is
    // minted as one — and `--resume <id>` reopens it. Assigning beats scanning:
    // the ref is on the row before the process has printed a byte, so even a
    // session killed during startup is resumable.
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://docs.claude.com/en/docs/claude-code/overview",
  },
  {
    agentKey: "codex",
    name: "Codex CLI",
    detectCmd: "codex",
    argv: [],
    expectedProcess: "codex",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // Confirmed against the clap definitions in codex rust-v0.147.0. Two things
    // make codex the awkward one:
    //
    // `resume` is a *subcommand*, not a flag, so it has to be the first token
    // after the binary — which is why session args are spliced immediately after
    // `argv` rather than appended. Adding anything to this agent's `argv` will
    // break resuming, and there is nowhere better to put the warning than here.
    //
    // Its session id is a bare UUID with nothing distinctive about it, so the
    // pattern anchors on the two lines codex actually prints and captures the id
    // out of the middle. A naked UUID pattern would match the first one to
    // appear anywhere in the session's output — very possibly one from a file
    // the agent was reading. `run codex resume <id>` is printed on a clean exit;
    // `Session ID: <id>` only on a fatal one. A *named* thread prints a third
    // form that carries no runnable id, and is deliberately not matched.
    sessionIdMode: "scan",
    newSessionArgs: [],
    resumeArgs: ["resume", "{id}"],
    sessionIdPattern:
      "(?:codex resume |Session ID: )([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
    unsupportedPlatforms: [],
    installUrl: "https://github.com/openai/codex",
  },
  {
    agentKey: "gemini",
    name: "Gemini CLI",
    detectCmd: "gemini",
    argv: [],
    expectedProcess: "gemini",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // Confirmed in `packages/cli/src/config/config.ts` at v0.55.1: `--session-id`
    // ("Start a new session with a manually provided UUID") and `--resume`,
    // which are mutually exclusive — never both, and this only ever sends one.
    //
    // The cleanest agent of the set: it takes an id up front *and* never prints
    // one, so assigning is not merely preferable, it is the only way. Note the
    // floor — `--session-id` landed in v0.41.0 and an older gemini rejects it as
    // an unknown flag, which fails the launch rather than degrading. That is the
    // deliberate trade: v0.41 is long superseded, and the alternative is no
    // resume for gemini at all.
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://github.com/google-gemini/gemini-cli",
  },
  {
    agentKey: "opencode",
    name: "OpenCode",
    detectCmd: "opencode",
    argv: [],
    expectedProcess: "opencode",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // Confirmed against the CLI's own `--help`: `-s, --session <id>` continues a
    // session, and there is deliberately no flag to name one at launch — so the
    // id has to be read back rather than assigned. OpenCode prints it as it
    // leaves, in the banner that offers `opencode -s ses_…`, which is precisely
    // when a resumable ref becomes worth having.
    //
    // The pattern is anchored on the `ses_` prefix and the identifier alphabet
    // rather than on the surrounding banner text, because the banner is
    // presentation and gets re-worded between releases while the id format is
    // the CLI's contract with itself.
    sessionIdMode: "scan",
    newSessionArgs: [],
    resumeArgs: ["--session", "{id}"],
    sessionIdPattern: "ses_[A-Za-z0-9]{16,}",
    unsupportedPlatforms: [],
    installUrl: "https://opencode.ai",
  },
  {
    agentKey: "cursor-agent",
    name: "Cursor Agent",
    detectCmd: "cursor-agent",
    argv: [],
    expectedProcess: "cursor-agent",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // `--resume <chatId>` is confirmed in Cursor's CLI docs, and is recorded
    // here so it is ready — but the mode stays `none`, so nothing ever offers
    // it. Cursor prints its `session_id` only under `--output-format json` and
    // `stream-json`; the interactive TUI this app launches prints no id at all,
    // and there is no flag to assign one. Neither capture route exists, so a
    // session launched from here can never learn its own id.
    //
    // The way in, if this is ever picked up: `cursor-agent create-chat` prints a
    // fresh id on stdout and exits, which would let APIWeave pre-allocate one
    // and then launch with `--resume <id>`. That is a third capture mode — spawn
    // a helper process before the agent — and it needs a real CLI to test
    // against, not least because `create-chat` had a documented hang.
    sessionIdMode: "none",
    newSessionArgs: [],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://cursor.com/cli",
  },
  {
    agentKey: "aider",
    name: "Aider",
    detectCmd: "aider",
    argv: [],
    expectedProcess: "aider",
    env: {},
    promptMode: "flag",
    promptFlag: "--message",
    mcpConfigArgs: [],
    briefingArgs: [],
    // Aider has no session id, and this is the one entry where that is a
    // finding rather than a gap: its argument parser (`aider/args.py`) contains
    // no `--session`, `--resume` or `--continue` at all. Resuming is
    // *directory*-scoped — `--restore-chat-history` reloads
    // `.aider.chat.history.md` from the git root — so there is nothing for an id
    // to identify. Anything put here would be invented.
    sessionIdMode: "none",
    newSessionArgs: [],
    resumeArgs: [],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://aider.chat",
  },
  // ── Added for reach, from documentation rather than from a local install ───
  //
  // The six above were in the roster before resume existed and were each
  // checked against a real binary at some point. These four were added to cover
  // the agents people actually use, and their flags come from official docs and
  // source. That is a weaker warrant, and it is spent deliberately: `argv`,
  // `promptMode` and `mcpConfigArgs` stay at the conservative defaults so the
  // only new claim each entry makes is how to resume it.
  {
    agentKey: "copilot",
    name: "GitHub Copilot CLI",
    detectCmd: "copilot",
    argv: [],
    expectedProcess: "copilot",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // `--session-id=<uuid>` "starts new sessions with a specific UUID" as well
    // as resuming known ones (docs + changelog from 1.0.51), and `--resume <id>`
    // reopens one. Assigning sidesteps the one thing the documentation does not
    // pin down: the literal text of its exit banner.
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli",
  },
  {
    agentKey: "qwen",
    name: "Qwen Code",
    detectCmd: "qwen",
    argv: [],
    expectedProcess: "qwen",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // `--session-id <uuid>` is validated as a UUID and refuses an id that
    // already exists, which is exactly the contract a minted id wants; `--resume
    // <id>` reopens one. Mutually exclusive with `--continue`/`--resume`, and
    // this only ever sends one of the two.
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://github.com/QwenLM/qwen-code",
  },
  {
    agentKey: "crush",
    name: "Crush",
    detectCmd: "crush",
    argv: [],
    expectedProcess: "crush",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // No way to assign an id, so this is a scan — and the thing it scans for is
    // not the session's UUID but the 7-character hash Crush prints in the
    // resume command on its way out (`Continue crush -s <hash>`). That hash is
    // what `-s` accepts, so it is the right thing to store even though it is not
    // the primary key: `-s` takes a full UUID, a full hash, or a hash prefix.
    sessionIdMode: "scan",
    newSessionArgs: [],
    resumeArgs: ["--session", "{id}"],
    sessionIdPattern: "crush -s ([0-9a-f]{7,})",
    unsupportedPlatforms: [],
    installUrl: "https://github.com/charmbracelet/crush",
  },
  {
    agentKey: "pi",
    name: "Pi",
    detectCmd: "pi",
    argv: [],
    expectedProcess: "pi",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    briefingArgs: [],
    // `--session <id>` is recorded and works, but the mode stays `none`, so
    // nothing offers it — the same shape as `cursor-agent`. Pi emits its id as
    // the first line of `--mode json` output and shows it in the TUI only behind
    // the `/session` command; the interactive session this app launches prints
    // no id anywhere it can be read, and there is no flag to assign one.
    sessionIdMode: "none",
    newSessionArgs: [],
    resumeArgs: ["--session", "{id}"],
    sessionIdPattern: null,
    unsupportedPlatforms: [],
    installUrl: "https://github.com/earendil-works/pi",
  },
]

export const DEFAULT_AGENT_KEY = "claude"

export function findBuiltinAgent(agentKey: string): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((agent) => agent.agentKey === agentKey)
}
