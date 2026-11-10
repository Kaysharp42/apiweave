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

/** MCP prompt arguments are always strings, and every APIWeave prompt's are optional. */
type PromptArgsShape = Readonly<Record<string, z.ZodOptional<z.ZodString>>>
type PromptArgs = Readonly<Record<string, string | undefined>>

export interface McpPromptSpec {
  readonly name: string
  readonly description: string
  readonly argsSchema: PromptArgsShape
  readonly build: (args: PromptArgs) => GetPromptResult
}

const AUTHOR_ASSERTIONS_DESCRIPTION =
  "Guide the agent to translate a natural-language assertion request into canonical rules, preview them for user approval when approval is needed, then apply them to an existing assertion node."

const SOURCES = AssertionSourceSchema.options.join(", ")
const OPERATORS = AssertionOperatorSchema.options.join(", ")

function buildAuthorAssertions(args: PromptArgs): GetPromptResult {
  const context = Object.keys(authorAssertionsArgs)
    .map((name) => (args[name] ? `- ${name}: ${args[name]}` : null))
    .filter((line): line is string => line !== null)

  const contextBlock =
    context.length > 0
      ? `The user is working in this context:\n${context.join("\n")}\n\n`
      : "No workflow/run context was supplied. Ask the user which workflow, assertion node, and (optionally) run to work against, or discover them with the read tools below.\n\n"

  const text = `You are authoring APIWeave workflow assertions on the user's behalf. APIWeave does NOT interpret natural language itself — you do.

${contextBlock}## Flow

1. **Inspect.** Read the workflow with \`workflows_get\` and \`view: "outline"\`. If a run is available, read it with \`runs_get\` and \`workflow_diagnose\`, and call \`assertion_suggest\` on the source HTTP node for deterministic candidates. These return metadata only — never raw bodies or secret values. Suggestions never modify the workflow; apply chosen rules explicitly.
2. **Translate.** Convert the user's intent into canonical assertion rules (schema below). Prefer the shapes returned by \`assertion_suggest\` when they match the intent.
3. **Validate & preview when approval or evidence is needed.** Call \`assertion_validate\` with the rules (plus \`runId\` to check against stored evidence) and show the returned human-readable \`preview\` and any \`issues\` to the user. If it is not \`valid\`, fix the rules and validate again — do not proceed on errors. Skip this call when the user already specified the exact rules and no preview was asked for: \`assertion_apply\` validates shape itself, and accepts \`runId\` to check evidence in the same call.
4. **Approve (approval flow only).** Ask the user to confirm the previewed rules. Do not apply anything without explicit approval when approval was requested.
5. **Apply.** Call \`assertion_apply\` with \`assertionNodeId\`, \`mode\` ("append" or "replace"), the validated \`rules\`, and \`expectedRevision\` taken from the workflow's current \`rev\` (returned by \`assertion_suggest\`, or by \`workflows_get\` with \`view: "outline"\`). If it returns a conflict, the user edited the workflow meanwhile — re-read, re-validate, and ask again.

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
- \`assertion_apply\` validates shape itself and is revision-guarded — an invalid or stale change is rejected regardless of what you send. Use \`assertion_validate\` first only when you need a preview, an evidence check, or explicit approval.`

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

const E2E_DESCRIPTION =
  "Test your API end to end in APIWeave: find or build the workflows from your code or description, run them, debug failures and report. Type what to test after the command, in quotes."

const e2eArgs = {
  task: z
    .string()
    .optional()
    .describe('What to test, e.g. "invoice create and list". Quote it: most clients pass only the first word otherwise.'),
} as const

/**
 * The task block. Clients split what the user typed after the command on
 * whitespace and hand a one-argument prompt only the first token unless it was
 * quoted (OpenCode 2.x, Claude Code), so a single word may be a truncated
 * sentence. OpenCode 1.x instead sends `$1` and substitutes the whole text into
 * our output, which is why the value is woven in verbatim.
 */
function e2eTaskBlock(rawTask: string | undefined): string {
  const task = rawTask?.trim() ?? ""
  if (task === "") {
    return `No task was typed. If the conversation already says what to test, do that. Otherwise ask one question — what should be tested: a feature, some endpoints, a user journey, or "run the existing tests" — and offer a concrete suggestion drawn from the workspace and the repository.`
  }
  const maybeCut = !/\s/.test(task) && !/^\$\d+$/.test(task)
  return `The user asked:

> ${task}${
    maybeCut
      ? `

Clients split what is typed after a command on spaces, so this may be only its first word. If it reads as cut short, ask for the full request before building anything.`
      : ""
  }`
}

function buildE2e(args: PromptArgs): GetPromptResult {
  const text = `You are testing the user's API end to end with APIWeave. Do the testing *in APIWeave*: find, build, run and debug workflows through the apiweave MCP tools. Do not write test scripts, curl loops or test files in the repository, and do not look for workflows on disk — they live in APIWeave's database, and these tools are the only way to reach them.

## Task

${e2eTaskBlock(args["task"])}

If the task is to run or check tests that already exist, find them and go straight to step 4 (\`projects_run\` runs a whole project in its saved order).

## 1. Find the scope

- If \`APIWEAVE_WORKSPACE_ID\` is set in your environment, APIWeave launched you: start there, with \`APIWEAVE_WORKFLOW_ID\` or \`APIWEAVE_PROJECT_ID\` when set.
- Otherwise \`workspaces_list\`, and pick the workspace whose name, projects or workflows match the task or the repository you are in. Ask only when it is genuinely ambiguous.
- \`workspaces_map\` lists every workflow's endpoints, variables and env/secret references. Reuse what exists: run or extend an existing workflow before creating a new one, and copy its base URL, auth and variable conventions.

## 2. Learn the API under test

- If the working directory is the service's code, read its routes, handlers, request validation and any OpenAPI spec for the real paths, required fields, status codes and auth. If it has a \`graphify-out/\` folder, use \`graphify query\`. Test what the code and the user promise, not what you guess.
- \`environments_list\` / \`environments_get\` show which environment holds the base URL and credentials; \`secrets_list\` shows which secret names exist.

## 3. Design the scenario

An end-to-end workflow follows a real user journey, with data flowing between the steps:

- authenticate once, extract the token and reuse it (\`{{variables.token}}\`);
- create, read back, update, list or filter, then delete — extracting ids from responses, never hard-coding them;
- an assertion node after every request that checks the status *and* the fields that matter, plus negative cases with \`expectedStatus\` (invalid input, not found, unauthorized, a forbidden state change);
- unique test data from dynamic functions such as \`{{uuid()}}\`, so reruns do not collide.

For a large surface, write one workflow per journey grouped in a project, not one giant graph. Read \`apiweave://guide/start-here\` (or \`guides_get\` with \`start-here\`) before the first write, and \`workflows_nodeSchema\` for any node type you have not used yet.

## 4. Build, diagnose, run, fix

1. Write with \`workflows_create\`, or \`workflows_patch\` with \`expectedRevision\`. Select the environment with \`workflows_setEnvironment\` and attach the workflow to its project with \`workflows_attachToCollection\`, if there is one.
2. Fix every \`error\` in the returned \`diagnosis\` before running. Diagnosis is free; a run is real HTTP.
3. \`runs_create\`. Before the first run, say which environment and base URL it will hit. If that looks like production, or the user has not said the tests may write to it, ask first.
4. On a failure, \`workflows_debugContext\`, then \`runs_getNodeResult\` for evidence. Decide whose bug it is:
   - **the workflow's** (a wrong path, body or variable, an unresolved placeholder): fix it and run again;
   - **the API's** (behaviour that contradicts the code, the spec or what the user asked for): keep the failing assertion and report it with its evidence. Never loosen or delete an assertion just to turn a run green.
5. After a green run, tighten assertions with \`assertion_suggest\`, whose paths are verified against the real response.

## Rules

- Reference secrets as \`{{secrets.NAME}}\`. Never write an observed credential, or \`<SECRET>\` from a read, into a workflow.
- Secrets cannot be created over MCP. When one is missing, tell the user its exact name and scope to add in APIWeave, and set that part aside.
- A run that uses secrets waits for the user's approval in APIWeave; \`deniedByUser: true\` means they refused — say so and do not retry.
- Do not delete or rewrite the user's existing workflows unless asked: add to them, or patch them.

## Report

Finish with: the workflows you created or changed (name, id, project) and what each covers; each one's last run result; API bugs found, with evidence; and anything the user must do next, such as a missing secret or environment variable.`

  return {
    description: E2E_DESCRIPTION,
    messages: [{ role: "user", content: { type: "text", text } }],
  }
}

/** `/apiweave:e2e` — the one command that puts an agent to work testing with APIWeave. */
export const E2E_PROMPT: McpPromptSpec = {
  name: "e2e",
  description: E2E_DESCRIPTION,
  argsSchema: e2eArgs,
  build: buildE2e,
}

export const MCP_PROMPTS: readonly McpPromptSpec[] = [E2E_PROMPT, AUTHOR_ASSERTIONS_PROMPT]
