// fallow-ignore-file code-duplication -- a documented data table: every entry shares one field shape by design ("adding an agent is a row, not code"), and each entry's own comments are sourced independently from a different CLI's docs, not copied from a neighbour; fallow 2.104 has no range form, so file-level is the narrowest marker that still covers the groups
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
 *
 * `configEnv` carries the same two halves for a CLI that has no flags to carry
 * them: a config file named by an environment variable (OpenCode's
 * `OPENCODE_CONFIG`), which APIWeave writes per session with the MCP server and
 * the briefing inside. Same confirmation rule as the other template fields.
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
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    configEnv: {},
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
    // Confirmed against codex-rs config source (config_override.rs,
    // mcp_types.rs) and the official MCP docs, Aug 2026. `-c key=value` applies
    // dotted-path TOML overrides on top of the user's config, and a value that
    // fails to parse as TOML falls back to a raw string — so the URL rides
    // unquoted, the one form that survives `cmd.exe` untouched. The token
    // travels by variable: `bearer_token_env_var` names it, `mcpConfigEnv`
    // sets its value, and neither the token nor quotes ever appear in argv.
    // `-c` is a global clap flag, so it parses after `resume <id>` too.
    mcpConfigArgs: [
      "-c",
      "mcp_servers.apiweave.url={url}",
      "-c",
      "mcp_servers.apiweave.bearer_token_env_var=APIWEAVE_MCP_TOKEN",
    ],
    mcpConfigEnv: { APIWEAVE_MCP_TOKEN: "{token}" },
    mcpConfigFormat: "claude",
    // No briefing carrier exists. `model_instructions_file` REPLACES Codex's
    // own instructions (source: "users are STRONGLY DISCOURAGED"), which is
    // the replace-not-append trap; `developer_instructions` is inline text,
    // and text in argv is exactly what the briefing-file rule forbids. Both
    // AGENTS.md slots are the project directory or a shared global file.
    briefingArgs: [],
    configEnv: {},
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
    // Confirmed in gemini-cli source (settings.ts, mcp-client.ts), Aug 2026:
    // there is no `--mcp-config` flag and the parser is `.strict()`, but
    // `GEMINI_CLI_SYSTEM_SETTINGS_PATH` names a settings.json layered at the
    // highest settings precedence — and the standard `mcpServers` file parses
    // as one, because `url` + `type: "http"` selects streamable HTTP (v0.21+).
    // `GEMINI_CLI_HOME` was rejected for this: it relocates auth tokens and
    // session state along with the config.
    mcpConfigArgs: [],
    mcpConfigEnv: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{path}" },
    mcpConfigFormat: "claude",
    // No briefing carrier: standing context is hierarchical GEMINI.md read
    // from the working directory upward — the user's repository — or a global
    // file shared by every gemini session on the machine.
    briefingArgs: [],
    configEnv: {},
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
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: [],
    // Confirmed against opencode 1.18.21. OpenCode has no flag for either
    // half — no `--mcp-config`, no system-prompt flag (`-c` is `--continue`) —
    // so both travel through a config file instead: `OPENCODE_CONFIG` names
    // one that OpenCode merges between the user's global and project configs,
    // and APIWeave fills it per session with the bridge server and the
    // briefing. Verified against the installed CLI with `opencode debug
    // config`: the flat `mcp` shape parses and the nested v2 `mcp.servers`
    // shape does not, and `instructions` takes an absolute path. OpenCode
    // deep-merges per-server entries, which is why the generated file sets
    // `enabled`, `url` and `headers` explicitly — see `opencode_config.ts`.
    configEnv: { OPENCODE_CONFIG: "{path}" },
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
    // No MCP carrier exists (Cursor docs, Aug 2026): servers are read only
    // from `~/.cursor/mcp.json` — every session on the machine — or
    // `.cursor/mcp.json` in the user's repository, and no per-invocation flag
    // is documented. Standing instructions are the same story: AGENTS.md and
    // `.cursor/rules`, both repository files.
    mcpConfigArgs: [],
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: [],
    configEnv: {},
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
    // Confirmed in aider's source (args.py, main.py) and docs: aider has no
    // MCP client at all — no mcp flag exists and three open feature requests
    // ask for one — so the briefing is the only carrier it gets, and the
    // briefing's own "without APIWeave's MCP server" wording is the truth for
    // it. `--read` is aider's documented way to load a read-only file into
    // every session from launch (the conventions and caching docs both
    // recommend it for exactly this); the file is chat context rather than a
    // system-prompt layer, which is the best aider offers and matches what the
    // briefing is: facts, not instructions about instructions.
    mcpConfigArgs: [],
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: ["--read", "{path}"],
    configEnv: {},
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
  // source. That is a weaker warrant than a local binary, and it is spent
  // deliberately: every non-default claim below cites where it was confirmed,
  // and an agent whose carriers could not be confirmed ships without them and
  // says why — an unwired agent is a smaller loss than a launch that errors.
  {
    agentKey: "copilot",
    name: "GitHub Copilot CLI",
    detectCmd: "copilot",
    argv: [],
    expectedProcess: "copilot",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    // Confirmed in the copilot-cli changelog (added v0.0.343; a later entry
    // extends it to headless mode): `--additional-mcp-config` adds or overrides
    // servers for this session only, `@`-prefixed to name a file, and takes
    // the same `mcpServers` shape this app already writes for Claude. No
    // briefing carrier: instructions are AGENTS.md /
    // `.github/copilot-instructions.md` inside the repository, which is the
    // user's, not ours to write.
    mcpConfigArgs: ["--additional-mcp-config", "@{path}"],
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: [],
    configEnv: {},
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
    // Confirmed in qwen-code source (config.ts, mcp-client.ts), Aug 2026:
    // `--mcp-config` is a Qwen addition upstream gemini-cli does not have
    // (v0.16+), never gated behind approval, and takes a file or inline JSON.
    // The file must be Qwen's field-based shape — its Claude normalization is
    // applied to `.mcp.json` files only, so the Claude shape here would connect
    // with the SSE transport — which is what `mcpConfigFormat: "qwen"`
    // selects. `--append-system-prompt` exists (v0.13+) but takes literal
    // text, and text in argv is what the briefing-file rule forbids.
    mcpConfigArgs: ["--mcp-config", "{path}"],
    mcpConfigEnv: {},
    mcpConfigFormat: "qwen",
    briefingArgs: [],
    configEnv: {},
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
    // No MCP carrier exists (Crush config docs, Aug 2026): Crush configures
    // itself from a `crushrc` in the project directory or a global one under
    // `$XDG_CONFIG_HOME/crush/` — the former is the user's repository, the
    // latter is shared by every session on the machine, and redirecting
    // XDG_CONFIG_HOME hides the user's own global config (providers, keys)
    // along with it. `mcp add` exists only as a crushrc command, and the
    // closest thing to standing instructions, `--system-prompt-prefix`, rides
    // a provider entry in that same global file.
    mcpConfigArgs: [],
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: [],
    configEnv: {},
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
    // No MCP carrier by design (pi's usage docs: "It intentionally does not
    // include built-in MCP"); the extensions that add one are third-party
    // packages, and wiring one would make a launch depend on someone else's
    // npm distribution. The briefing carrier is confirmed in pi's args.ts:
    // `--append-system-prompt` takes text OR a file path, and
    // resource-loader.ts reads an existing path's contents in — so the
    // briefing file rides as-is, no text in argv.
    mcpConfigArgs: [],
    mcpConfigEnv: {},
    mcpConfigFormat: "claude",
    briefingArgs: ["--append-system-prompt", "{path}"],
    configEnv: {},
    // Confirmed in pi's args.ts, Aug 2026 — this entry shipped before the
    // flags did. `--session-id <id>` uses an exact project session id,
    // creating it if missing, which makes pi an assign agent. Note that
    // `--resume` takes no value at all (it opens a picker); reopening by id is
    // `--session <path|id>`, recorded below — the flag this row always carried
    // but could never reach.
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
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
