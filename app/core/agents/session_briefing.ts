import type { AgentScopeKind } from "@shared/types/AgentScope"
import path from "node:path"
import { scratchFileKind, writeScratchFile } from "./scratch_files"

/**
 * What a launched agent is told about the session before the user types a word.
 *
 * Everything here is a fact APIWeave already knows at launch and the agent
 * cannot discover: which workspace, which workflow, and that the workflow is not
 * a file in the folder it just started in. Without it every session opens with
 * the user typing the same three paragraphs, and an agent that skips them starts
 * by grepping the repository for a workflow that was never on disk.
 */
export interface AgentBriefingContext {
  readonly workspaceId: string
  readonly scopeKind: AgentScopeKind
  readonly scopeId: string
  /** The workflow's or project's own name, when the row still has one. */
  readonly scopeName: string | null
  /** The folder the agent is starting in — the user's repository, not APIWeave's. */
  readonly cwd: string
  /**
   * Whether this launch also wires up the MCP bridge. False for an agent whose
   * definition names no `mcpConfigArgs`, and when the bridge is off — and the
   * briefing has to say so, because every instruction in it that matters routes
   * through a tool that will not be there.
   */
  readonly mcpWired: boolean
}

/**
 * The briefing scratch kind. Exported as the object rather than re-exported
 * field by field, so the surface stays the factory's: `filename`, `deleteOne`,
 * `sweep` — no per-kind aliases to drift apart.
 *
 * `deleteOne` is best-effort by design (see `scratch_files.deleteScratchFile`):
 * the caller is a terminal state transition, and a session that already ended
 * must not fail to be recorded because a scratch file was already gone (or is
 * held open on Windows). `sweep` reclaims what a crash left; it runs for the
 * weaker of the two reasons the config sweep exists — no secret is at stake
 * here, only files that would otherwise accumulate one per session for ever.
 */
export const BRIEFING_SCRATCH = scratchFileKind("briefing-", ".md")

/**
 * The briefing text for one session.
 *
 * Deliberately short, and deliberately not a copy of the guides. The guides are
 * already served as MCP resources and are far too long to prepend to every
 * session; what this adds is the part no guide can carry — which workflow, which
 * folder, which workspace — plus the pointer that makes the guides findable at
 * all. Anything that would be equally true in every session belongs in a guide,
 * not here.
 */
export function buildSessionBriefing(context: AgentBriefingContext): string {
  const isWorkflow = context.scopeKind === "workflow"
  const label = isWorkflow ? "Workflow" : "Project"
  const named = context.scopeName === null ? context.scopeId : `"${context.scopeName}" (${context.scopeId})`
  const idVariable = isWorkflow ? "APIWEAVE_WORKFLOW_ID" : "APIWEAVE_PROJECT_ID"

  return `# APIWeave session briefing

You were launched from APIWeave, a desktop app for building and running API test
workflows. A workflow is a graph of nodes — HTTP requests, assertions, delays —
that the user runs against a real service. The user is looking at it while you
work, so changes you make appear on their canvas as you make them.

## What this session is attached to

- ${label}: ${named}
- Workspace: ${context.workspaceId}
- Folder you are running in: ${context.cwd}

The same ids are in your environment, as \`APIWEAVE_WORKSPACE_ID\` and
\`${idVariable}\`.

## The workflow is not in this folder

It lives in APIWeave's own database. ${
    context.mcpWired
      ? "The `apiweave` MCP server is already connected to this session, and it is the only way to read or change one."
      : "This session was launched without APIWeave's MCP server, so you cannot read or change one — say so if the user asks you to, rather than editing files and hoping."
  }
The folder above is the user's own code: read it to learn what the API under
test actually does, but do not go looking for the workflow in it.

## Before your first tool call

1. Read \`apiweave://guide/start-here\`. It is the order of operations that
   avoids wasted runs, and it is short.
2. Read the ${label.toLowerCase()} itself — \`workflows_get\` with the id above${
    isWorkflow ? "" : ", or `workflows_list` for what the project contains"
  }.
3. \`tools/list\` and \`resources/list\` are the rest of the surface; the other
   guides are listed by \`server_info\`.

## Conventions that are easy to get wrong

- Prefer \`workflows_patch\` over \`workflows_update\`: patch changes nodes by
  id, update replaces the whole graph.
- Writes are revision-guarded. Send the \`rev\` you last read as
  \`expectedRevision\`; a conflict means the user edited it while you worked, so
  re-read rather than retry.
- Every write returns a \`diagnosis\`. Read it and fix the errors it names
  before moving on — a graph with a bad edge saves cleanly and only misbehaves
  at run time.
- \`runs_create\` sends real HTTP to a real service. Everything else is free;
  that is not.
- Reads withhold secret values by design. Never copy a credential into a
  workflow — reference it as \`{{secrets.NAME}}\`.

The user asked for an agent, not an autopilot: confirm before deleting anything
you did not create.
`
}

/**
 * Write one session's briefing and return its path.
 *
 * A file rather than the text spliced into argv, for the same reason the MCP
 * config is a file: on Windows a `.cmd` shim is launched through `cmd.exe /c`,
 * and this text contains the characters — `&`, `|`, `%`, newlines — that a
 * command line is parsed for. A path has none of them. It also keeps a couple of
 * kilobytes out of a command line that has a hard 32k limit there.
 *
 * `0o600` like the config beside it. This one holds no token, but it does name
 * the user's projects and folders, and it lives in the same directory.
 */
export function writeSessionBriefing(scratchDir: string, sessionId: string, text: string): string {
  return writeScratchFile(scratchDir, BRIEFING_SCRATCH.filename(sessionId), text, 0o600)
}

/**
 * The path this session's briefing occupies — the name without the write.
 *
 * A launcher config can carry the briefing by embedding its path (OpenCode's
 * `instructions`), and by the time that file is written the briefing's own
 * write has already happened on the argv path — same scratch directory, same
 * session-named filename. Computing the path rather than passing it in keeps
 * the two writers from needing an order between them.
 */
export function briefingPathFor(scratchDir: string, sessionId: string): string {
  return path.join(scratchDir, BRIEFING_SCRATCH.filename(sessionId))
}

/**
 * Substitute the briefing's path into a definition's `briefingArgs` template.
 *
 * The same `{path}` convention as `mcpConfigArgs`, and a separate function
 * rather than a shared one so neither template's meaning is defined by the
 * other: they fill different flags of different CLIs and are free to diverge.
 */
export function renderBriefingArgs(template: readonly string[], briefingPath: string): readonly string[] {
  return template.map((argument) => argument.replaceAll("{path}", briefingPath))
}
