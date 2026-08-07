import { z } from "zod"
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js"
import { AssertionOperatorSchema } from "@shared/zod-schemas/AssertionOperatorSchema"
import { AssertionSourceSchema } from "@shared/zod-schemas/AssertionSourceSchema"

/**
 * MCP prompts — reusable instruction templates the connected agent runs. Unlike
 * tools, a prompt executes no code and touches no data: it returns text that
 * steers the *client's* model. This is how APIWeave does natural-language
 * assertion authoring without embedding an LLM (plan §4.2): the agent maps the
 * user's words to canonical rules, we validate/apply them through the same
 * revision-guarded tools.
 *
 * The canonical source/operator lists are pulled from the shared Zod enums so the
 * guidance can never drift from what `assertion_validate`/`assertion_apply` accept.
 */

/** Optional context args. All strings (MCP prompt args are always strings) and all
 * optional so the prompt is discoverable via `prompts/list` before any data exists. */
const authorAssertionsArgs = {
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  assertionNodeId: z.string().optional(),
  runId: z.string().optional(),
} as const

interface AuthorAssertionsArgs {
  readonly workspaceId?: string | undefined
  readonly workflowId?: string | undefined
  readonly assertionNodeId?: string | undefined
  readonly runId?: string | undefined
}

export interface McpPromptSpec {
  readonly name: string
  readonly description: string
  readonly argsSchema: typeof authorAssertionsArgs
  readonly build: (args: AuthorAssertionsArgs) => GetPromptResult
}

const AUTHOR_ASSERTIONS_DESCRIPTION =
  "Guide the agent to translate a natural-language assertion request into canonical rules, validate/preview them, get user approval, then apply them to an existing assertion node."

const SOURCES = AssertionSourceSchema.options.join(", ")
const OPERATORS = AssertionOperatorSchema.options.join(", ")

function buildAuthorAssertions(args: AuthorAssertionsArgs): GetPromptResult {
  const context = [
    args.workspaceId ? `- workspaceId: ${args.workspaceId}` : null,
    args.workflowId ? `- workflowId: ${args.workflowId}` : null,
    args.assertionNodeId ? `- assertionNodeId: ${args.assertionNodeId}` : null,
    args.runId ? `- runId: ${args.runId}` : null,
  ].filter((line): line is string => line !== null)

  const contextBlock =
    context.length > 0
      ? `The user is working in this context:\n${context.join("\n")}\n\n`
      : "No workflow/run context was supplied. Ask the user which workflow, assertion node, and (optionally) run to work against, or discover them with the read tools below.\n\n"

  const text = `You are authoring APIWeave workflow assertions on the user's behalf. APIWeave does NOT interpret natural language itself — you do. Follow this flow and never skip validation or approval.

${contextBlock}## Flow

1. **Inspect.** Read the workflow with \`workflows_get\`. If a run is available, read it with \`runs_get\` and \`workflow_diagnose\`, and call \`assertion_suggest\` on the source HTTP node for deterministic candidates. These return metadata only — never raw bodies or secret values.
2. **Translate.** Convert the user's intent into canonical assertion rules (schema below). Prefer the shapes returned by \`assertion_suggest\` when they match the intent.
3. **Validate & preview.** Call \`assertion_validate\` with the rules. Show the returned human-readable \`preview\` and any \`issues\` to the user. If it is not \`valid\`, fix the rules and validate again — do not proceed on errors.
4. **Approve.** Ask the user to confirm the previewed rules. Do not apply anything without explicit approval.
5. **Apply.** Call \`assertion_apply\` with \`assertionNodeId\`, \`mode\` ("append" or "replace"), the validated \`rules\`, and \`expectedRevision\` taken from the workflow's current \`rev\` (from \`workflows_get\`). If it returns a conflict, the user edited the workflow meanwhile — re-read, re-validate, and ask again.

## Canonical rule schema

Each rule is \`{ source, path, operator, expectedValue? }\`:

- **source** — one of: ${SOURCES}.
- **operator** — one of: ${OPERATORS}. \`exists\`/\`notExists\` take no \`expectedValue\`; every other operator requires one.
- **path** rules:
  - \`status\`: path MUST be empty; use a numeric operator (equals, notEquals, gt, gte, lt, lte). Example: \`{ "source": "status", "path": "", "operator": "equals", "expectedValue": 200 }\`.
  - \`prev\` (the upstream HTTP response): the path addresses the response object — \`response.body.<field>\` (dot notation, \`[0]\` for array indexes), \`response.headers.<name>\`, \`response.statusCode\` or \`response.duration\`. A bare field name like \`id\` is NOT a path; write \`response.body.id\`. Examples: \`response.body.token\` exists, \`response.body.items\` count 3, \`response.duration\` lte 500.
  - \`variables\`, \`headers\`, \`cookies\`: path is the name and is required, with no \`response.\` prefix. Example header: \`{ "source": "headers", "path": "content-type", "operator": "contains", "expectedValue": "application/json" }\`.
- \`count\` requires a non-negative integer \`expectedValue\`.

The full reference is the \`apiweave://guide/assertions\` resource.

## Safety rules

- Never copy an observed token, password, or other secret-looking value into an \`expectedValue\`. If the user wants to compare against a secret, use a \`{{secrets.NAME}}\` reference — literal credential values are rejected by validation.
- Assertions attach to an existing assertion node whose single upstream HTTP node is the source. This prompt does not create new nodes.
- Everything you apply must pass \`assertion_validate\` first, and \`assertion_apply\` is revision-guarded — an invalid or stale change is rejected regardless of what you send.`

  return {
    description: AUTHOR_ASSERTIONS_DESCRIPTION,
    messages: [{ role: "user", content: { type: "text", text } }],
  }
}

export const AUTHOR_ASSERTIONS_PROMPT: McpPromptSpec = {
  name: "author_assertions",
  description: AUTHOR_ASSERTIONS_DESCRIPTION,
  argsSchema: authorAssertionsArgs,
  build: buildAuthorAssertions,
}

export const MCP_PROMPTS: readonly McpPromptSpec[] = [AUTHOR_ASSERTIONS_PROMPT]
