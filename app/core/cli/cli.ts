import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import type { RequestInit, Response } from "undici"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import { initDatabase } from "../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  ProjectRunRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../repositories"
import { LocalOwnerProvider } from "../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../sync/LocalOnlySyncProvider"
import { ScopeResolver } from "../services/scope_resolver"
import { ImportService, WorkflowBundleSchema } from "../services/import_service"
import { ProjectExportService, type ProjectBundle } from "../services/project_export_service"
import { readProjectFolder } from "../services/project_folder"
import { convertPostmanCollection, isPostmanCollection } from "../services/postman_import"
import { isPostmanEnvironment, parseDotenv } from "@shared/env-file/envFile"
import { extractSecretRefsFromString } from "../services/secret_utils"
import { DynamicFunctions } from "../runner/dynamic_functions"
import { SafeHttp, type SafeFetchOptions } from "../runner/safe_http"
import { loadCaCertificates, loadClientCertificate, type NetworkConfig } from "../runner/network"
import { RunScheduler } from "../runner/scheduler"
import { ProjectRunner, planProjectRun } from "../runner/project_runner"
import { buildConsoleReport, buildReport, type ReportInput, type SingleReportInput } from "../runner/reporters"
import { MAX_ITERATION_DATA_BYTES, parseIterationData, type IterationRow } from "@shared/iteration-data/iterationData"
import { createSecretMasker } from "../runner/secret_masker"
import { CryptoRandomProvider, WallClockProvider } from "../runner/harness/providers"

/**
 * `apiweave run <file>`: the headless runner CI uses. Plain Node — no Electron,
 * keychain or MCP — so it runs under the `node` a CI image already has.
 *
 * CI has no APIWeave database, so the run starts from the files a user
 * exports: a workflow export, a `.awecollection` project bundle, or a Postman
 * Collection v2.1, converted the way the app's Postman import does. They are
 * imported through the app's own import services into an in-memory SQLite
 * database that disappears with the process, then run by the same scheduler
 * and project runner as the app. Bundles carry secret references only; the
 * values come from the environment (`APIWEAVE_SECRET_<NAME>`), `--secret` or
 * `--secrets-file` and stay in memory. Every line written, and every report,
 * goes through the run's secret masker.
 *
 * Exit codes: 0 every run passed, 1 a test failed, 2 usage or configuration
 * error (nothing ran).
 */

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly stdout: { write(text: string): unknown; readonly isTTY?: boolean }
  readonly stderr: { write(text: string): unknown }
}

export const EXIT_PASSED = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2

/** Prefix of the environment variables that carry secret values: `APIWEAVE_SECRET_API_TOKEN` is `{{secrets.API_TOKEN}}`. */
export const SECRET_ENV_PREFIX = "APIWEAVE_SECRET_"

const REPORTERS = new Set(["cli", "junit", "html"])

export const USAGE = `Usage: apiweave run <file|folder> [options]

Runs a project folder (exported with "Export to folder"), a workflow export
(.json), a project bundle (.awecollection) or a Postman Collection v2.1
(.postman_collection.json) and exits 0 when every run passes, 1 when a test
fails, 2 on a usage or config error.

Options:
  -w, --workflow <name|id>        Run one workflow of a project folder or bundle
  -e, --env <name>                Environment from the file to run against
      --env-file <file>           Environment variables, JSON object or dotenv
                                  (a Postman environment, for a Postman collection)
      --var <key=value>           Set an environment variable (repeatable)
      --secret <NAME=value>       Secret value (repeatable)
      --secrets-file <file>       Secret values, JSON object or dotenv
  -r, --reporter <list>           cli, junit, html; comma separated (default cli)
      --reporter-junit-export <path>  JUnit XML file (default apiweave-report.xml)
      --reporter-html-export <path>   HTML file (default apiweave-report.html)
  -d, --iteration-data <file>     Run once per row of a CSV or JSON array file;
                                  each row's values are {{data.<column>}}
  -n, --iteration-count <n>       Run n times (with --iteration-data: its first n rows)
      --bail                      Stop at the first failed workflow or iteration
      --timeout-request <ms>      Timeout for every request, overriding each node's
  -k, --insecure                  Do not verify TLS certificates
      --proxy <url>               Send requests through this proxy (default: the
                                  HTTPS_PROXY or HTTP_PROXY variable; NO_PROXY applies)
      --ca-cert <file>            Also trust this CA certificate, PEM (repeatable)
      --use-system-ca             Also trust the operating system's certificate store
      --client-cert <spec>        Client certificate (mTLS) for a host (repeatable):
                                  host=cert.pem,key.pem[,PASSPHRASE_SECRET] or
                                  host=client.pfx[,PASSPHRASE_SECRET]; host may be
                                  *.example.com and may end in :port
  -h, --help                      Show this help

Secrets are read from ${SECRET_ENV_PREFIX}<NAME> environment variables too.
`

class UsageError extends Error {}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let mask = (text: string): string => text
  const fail = (message: string): number => {
    io.stderr.write(mask(`apiweave: ${message}\n`))
    return EXIT_USAGE
  }
  let options: CliOptions | "help"
  try {
    options = parseCliArgs(argv, io.cwd)
  } catch (error) {
    return fail(`${errorMessage(error)}\n\n${USAGE}`)
  }
  if (options === "help") {
    io.stdout.write(USAGE)
    return EXIT_PASSED
  }
  try {
    const secrets = collectSecrets(options, io.env)
    mask = createSecretMasker(secrets.values())
    return await execute(options, secrets, io, mask)
  } catch (error) {
    return fail(errorMessage(error))
  }
}

interface CliOptions {
  readonly file: string
  readonly workflow: string | undefined
  readonly env: string | undefined
  readonly envFile: string | undefined
  readonly vars: readonly string[]
  readonly secrets: readonly string[]
  readonly secretsFile: string | undefined
  readonly reporters: ReadonlySet<string>
  readonly junitPath: string
  readonly htmlPath: string
  readonly iterationData: string | undefined
  readonly iterationCount: number | undefined
  readonly bail: boolean
  readonly timeoutMs: number | undefined
  readonly insecure: boolean
  readonly proxy: string | undefined
  readonly caCerts: readonly string[]
  readonly useSystemCa: boolean
  readonly clientCerts: readonly string[]
}

function parseCliArgs(argv: readonly string[], cwd: string): CliOptions | "help" {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      workflow: { type: "string", short: "w" },
      env: { type: "string", short: "e" },
      "env-file": { type: "string" },
      var: { type: "string", multiple: true },
      secret: { type: "string", multiple: true },
      "secrets-file": { type: "string" },
      reporter: { type: "string", short: "r" },
      "reporter-junit-export": { type: "string" },
      "reporter-html-export": { type: "string" },
      "iteration-data": { type: "string", short: "d" },
      "iteration-count": { type: "string", short: "n" },
      bail: { type: "boolean" },
      "timeout-request": { type: "string" },
      insecure: { type: "boolean", short: "k" },
      proxy: { type: "string" },
      "ca-cert": { type: "string", multiple: true },
      "use-system-ca": { type: "boolean" },
      "client-cert": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  })
  if (values.help === true) return "help"
  const [command, file, ...rest] = positionals
  if (command !== "run") throw new UsageError(command === undefined ? "missing command" : `unknown command '${command}'`)
  if (file === undefined) throw new UsageError("missing <file|folder> to run")
  if (rest.length > 0) throw new UsageError(`unexpected argument '${rest[0]}'`)

  const reporters = new Set((values.reporter ?? "cli").split(",").map((name) => name.trim()).filter((name) => name !== ""))
  for (const name of reporters) {
    if (!REPORTERS.has(name)) throw new UsageError(`unknown reporter '${name}' (use cli, junit or html)`)
  }
  // Naming an export path asks for that report.
  if (values["reporter-junit-export"] !== undefined) reporters.add("junit")
  if (values["reporter-html-export"] !== undefined) reporters.add("html")

  let timeoutMs: number | undefined
  if (values["timeout-request"] !== undefined) {
    timeoutMs = Number(values["timeout-request"])
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new UsageError("--timeout-request must be a positive whole number of milliseconds")
  }
  let iterationCount: number | undefined
  if (values["iteration-count"] !== undefined) {
    iterationCount = Number(values["iteration-count"])
    if (!Number.isInteger(iterationCount) || iterationCount <= 0) throw new UsageError("--iteration-count must be a positive whole number")
  }
  const resolve = (target: string | undefined): string | undefined => (target === undefined ? undefined : path.resolve(cwd, target))
  return {
    file: path.resolve(cwd, file),
    workflow: values.workflow,
    env: values.env,
    envFile: resolve(values["env-file"]),
    vars: values.var ?? [],
    secrets: values.secret ?? [],
    secretsFile: resolve(values["secrets-file"]),
    reporters,
    junitPath: path.resolve(cwd, values["reporter-junit-export"] ?? "apiweave-report.xml"),
    htmlPath: path.resolve(cwd, values["reporter-html-export"] ?? "apiweave-report.html"),
    iterationData: resolve(values["iteration-data"]),
    iterationCount,
    bail: values.bail === true,
    timeoutMs,
    insecure: values.insecure === true,
    proxy: values.proxy,
    caCerts: (values["ca-cert"] ?? []).map((file) => path.resolve(cwd, file)),
    useSystemCa: values["use-system-ca"] === true,
    clientCerts: values["client-cert"] ?? [],
  }
}

/**
 * `--proxy` (or the HTTPS_PROXY / HTTP_PROXY variables, with NO_PROXY),
 * `--ca-cert`, `--use-system-ca` and `--client-cert`, loaded. A client
 * certificate's passphrase is a secret name, read like any other secret.
 */
function networkConfig(options: CliOptions, secrets: ReadonlyMap<string, string>, env: CliIo["env"], cwd: string): NetworkConfig {
  const proxy = options.proxy ?? env["HTTPS_PROXY"] ?? env["https_proxy"] ?? env["HTTP_PROXY"] ?? env["http_proxy"]
  const noProxy = env["NO_PROXY"] ?? env["no_proxy"]
  if (proxy !== undefined && proxy !== "") {
    let parsed: URL | undefined
    try {
      parsed = new URL(proxy)
    } catch {
      parsed = undefined
    }
    if (parsed === undefined || !["http:", "https:"].includes(parsed.protocol)) throw new UsageError("the proxy must be an http:// or https:// URL")
  }
  const clientCertificates = options.clientCerts.map((spec) => {
    const separator = spec.indexOf("=")
    const files = separator < 0 ? [] : spec.slice(separator + 1).split(",").map((part) => part.trim())
    if (separator <= 0 || files.length === 0 || files[0] === "") {
      throw new UsageError(`--client-cert must look like host=cert.pem,key.pem[,PASSPHRASE_SECRET] or host=client.pfx[,PASSPHRASE_SECRET], got '${spec}'`)
    }
    const isPfx = /\.(pfx|p12)$/i.test(files[0]!)
    const [first, second] = files.map((file) => path.resolve(cwd, file))
    const secretName = isPfx ? files[1] : files[2]
    if (!isPfx && second === undefined) throw new UsageError(`--client-cert ${spec}: a PEM certificate needs its key file after it`)
    const passphrase = secretName === undefined ? undefined : secrets.get(secretName)
    if (secretName !== undefined && passphrase === undefined) {
      throw new UsageError(`--client-cert ${spec}: missing secret ${secretName}. Set ${SECRET_ENV_PREFIX}${secretName} or pass --secret ${secretName}=value.`)
    }
    return loadClientCertificate({
      host: spec.slice(0, separator),
      ...(isPfx ? { pfxFile: first! } : { certFile: first!, keyFile: second! }),
      ...(passphrase === undefined ? {} : { passphrase }),
    })
  })
  return {
    ...(proxy ? { proxy } : {}),
    ...(noProxy ? { noProxy } : {}),
    ca: loadCaCertificates(options.caCerts),
    useSystemCa: options.useSystemCa,
    clientCertificates,
  }
}

/** Later sources win: `--secrets-file`, then `APIWEAVE_SECRET_*`, then `--secret`. A Map, so a name like `constructor` is just a name. */
function collectSecrets(options: CliOptions, env: CliIo["env"]): Map<string, string> {
  const secrets = new Map<string, string>()
  if (options.secretsFile !== undefined) {
    for (const [name, value] of Object.entries(readKeyValueFile(options.secretsFile, "--secrets-file"))) {
      if (typeof value !== "string") throw new UsageError(`--secrets-file: the value of '${name}' must be a string`)
      secrets.set(name, value)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(SECRET_ENV_PREFIX) && key.length > SECRET_ENV_PREFIX.length && value !== undefined) {
      secrets.set(key.slice(SECRET_ENV_PREFIX.length), value)
    }
  }
  for (const [name, value] of parsePairs(options.secrets, "--secret")) secrets.set(name, value)
  return secrets
}

async function execute(options: CliOptions, secrets: ReadonlyMap<string, string>, io: CliIo, mask: (text: string) => string): Promise<number> {
  // A project folder (`project.json` + workflows/ + environments/) is read through the app's own folder reader.
  const folder = isDirectory(options.file) ? readProjectFolder(options.file) : undefined
  const bundle = folder ?? readJson(options.file)
  const rows = readIterationRows(options)
  const envFileVariables = options.envFile === undefined ? {} : readKeyValueFile(options.envFile, "--env-file")
  // A Postman environment is the collection's own environment, converted with it, not overrides.
  const postmanEnvironment = isPostmanCollection(bundle) && isPostmanEnvironment(envFileVariables) ? envFileVariables : undefined
  const database = initDatabase({ databasePath: ":memory:" })
  let scheduler: RunScheduler | undefined
  let http: CliHttp | undefined
  try {
    const workspaces = new WorkspaceRepository(database.kvStore)
    const workflows = new WorkflowRepository(database.kvStore)
    const runs = new RunRepository(database.kvStore)
    const environments = new EnvironmentRepository(database.kvStore)
    const collections = new CollectionRepository(database.kvStore)
    const projectRuns = new ProjectRunRepository(database.kvStore)
    const scopeResolver = new ScopeResolver({
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    })
    const sync = new LocalOnlySyncProvider()
    const permissions = new LocalOwnerProvider()
    const workspaceId = workspaces.create({ name: "APIWeave CLI", slug: "apiweave-cli" }).workspaceId

    // -------- Load the file through the app's own importers --------
    let target: { readonly kind: "workflow"; readonly workflowId: string } | { readonly kind: "project"; readonly projectId: string }
    if (isPostmanCollection(bundle) || (isRecord(bundle) && bundle["type"] === "awecollection")) {
      const projectBundle = isPostmanCollection(bundle)
        ? convertPostmanCollection(bundle, { workspaceId, environment: postmanEnvironment }).bundle
        : bundle as unknown as ProjectBundle
      const projects = new ProjectExportService(collections, workflows, environments, sync, permissions, scopeResolver)
      // A folder imports as the app's "Import from folder" does (ids kept); a bundle as its bundle import does.
      const { projectId } = folder === undefined
        ? await projects.importProject(workspaceId, projectBundle)
        : await projects.upsertProject(workspaceId, projectBundle)
      target = options.workflow === undefined
        ? { kind: "project", projectId }
        : { kind: "workflow", workflowId: pickWorkflow(workflows.listByCollection(workspaceId, projectId).items, projectBundle, options.workflow) }
    } else if (isRecord(bundle) && isRecord(bundle["workflow"])) {
      if (options.workflow !== undefined) throw new UsageError("--workflow picks a workflow in a project bundle; this file is a single workflow")
      const { workflowId } = await new ImportService(workflows, environments, collections, sync, permissions, scopeResolver)
        .importWorkflow(workspaceId, WorkflowBundleSchema.parse(bundle), true, false)
      target = { kind: "workflow", workflowId }
    } else {
      throw new UsageError(`${options.file} is not an APIWeave project folder, workflow export, .awecollection project bundle or Postman collection`)
    }

    // -------- Environment --------
    // `--env` runs everything against that environment. Without it each
    // workflow runs against its own saved one, as in the app (null tells the
    // scheduler to use the workflow's). `--env-file` and `--var` are layered on
    // whichever environments will be used.
    const available = environments.listByWorkspace(workspaceId).items
    let environmentId: string | null = null
    if (options.env !== undefined) {
      const matches = available.filter((environment) => environment.name === options.env)
      if (matches.length !== 1) {
        const names = available.map((environment) => environment.name).join(", ") || "none"
        throw new UsageError(`environment '${options.env}' is ${matches.length === 0 ? "not in" : "ambiguous in"} the file (environments: ${names})`)
      }
      environmentId = matches[0]!.environmentId
    }
    const overrides: Record<string, JsonValue> = {
      ...(postmanEnvironment === undefined ? envFileVariables : {}),
      ...Object.fromEntries(parsePairs(options.vars, "--var")),
    }
    if (Object.keys(overrides).length > 0) {
      for (const environment of available) {
        if (environmentId === null || environment.environmentId === environmentId) {
          environments.update(environment.environmentId, { variables: { ...environment.variables, ...overrides } })
        }
      }
      if (environmentId === null) {
        // A workflow saved without an environment gets one holding just the overrides.
        let cliEnvironmentId: string | undefined
        for (const workflow of workflows.listByWorkspace(workspaceId, true).items) {
          if (workflow.selectedEnvironmentId !== null) continue
          cliEnvironmentId ??= environments.create({ workspaceId, name: "CLI", variables: overrides }).environmentId
          workflows.update(workflow.workflowId, { selectedEnvironmentId: cliEnvironmentId })
        }
      }
    }

    // -------- Secrets: refuse to start a run that would send a placeholder --------
    const roots = target.kind === "workflow" ? [target.workflowId] : projectWorkflowIds(target.projectId, workspaceId, collections, workflows)
    const missing = referencedSecrets(roots, workspaceId, workflows).filter((name) => !secrets.has(name))
    if (missing.length > 0) {
      throw new UsageError(
        `missing secret${missing.length === 1 ? "" : "s"} ${missing.join(", ")}. ` +
          `Set ${missing.map((name) => SECRET_ENV_PREFIX + name).join(", ")}, or pass --secret NAME=value or --secrets-file.`,
      )
    }
    if (options.bail && target.kind === "project") {
      const project = collections.getById(target.projectId)!
      collections.update(target.projectId, { workflowOrder: project.workflowOrder.map((item) => ({ ...item, continueOnFail: false })) })
    }

    // -------- Run --------
    http = new CliHttp(
      {
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.insecure ? { rejectUnauthorized: false } : {}),
      },
      networkConfig(options, secrets, io.env, io.cwd),
    )
    const clock = new WallClockProvider()
    const rng = new CryptoRandomProvider()
    const runScheduler = new RunScheduler({
      runs,
      workflows,
      environments,
      http,
      functions: new DynamicFunctions(clock, rng),
      clock,
      rng,
      // One OAuth 2.0 token cache per invocation: iterations reuse a client-credentials token.
      oauthTokens: new Map(),
      resolveSecret: async (name) => {
        const plaintext = secrets.get(name)
        return plaintext === undefined ? { plaintext: null, scopeType: null } : { plaintext, scopeType: "workspace" }
      },
    })
    scheduler = runScheduler

    // One run of the target: a workflow run, or a project run. `data` is the
    // iteration's row.
    const runOnce = async (data?: IterationRow): Promise<SingleReportInput> => {
      const withData = data === undefined ? {} : { data }
      if (target.kind === "workflow") {
        const runId = runScheduler.enqueue({ workspaceId, workflowId: target.workflowId, selectedEnvironmentId: environmentId, ...withData })
        await runScheduler.whenFinished(runId)
        // Always the persisted run: secrets are masked when a run is stored.
        const run = runs.getById(runId)!
        return { kind: "run", run, workflow: workflows.getById(run.workflowId) ?? null }
      }
      const projectRun = await new ProjectRunner({ projectRuns, collections, workflows, environments, runs, scheduler: runScheduler })
        .start({ workspaceId, projectId: target.projectId, environmentId, ...withData }).done
      const itemRuns = projectRun.items.flatMap((item) => (item.runId === null ? [] : [runs.getById(item.runId)])).filter((run) => run !== undefined)
      const itemWorkflows = [...new Set(projectRun.items.map((item) => item.workflowId))]
        .map((workflowId) => workflows.getById(workflowId))
        .filter((workflow) => workflow !== undefined)
      return { kind: "project", projectName: collections.getById(projectRun.projectId)!.name, projectRun, runs: itemRuns, workflows: itemWorkflows }
    }
    const statusOf = (one: SingleReportInput): string => (one.kind === "run" ? one.run.status : one.projectRun.status)

    let input: ReportInput
    let passed: boolean
    if (rows === undefined) {
      input = await runOnce()
      passed = statusOf(input) === "completed"
    } else {
      // Iterations run one after another; a failed one stops the rest only with --bail.
      const iterations: SingleReportInput[] = []
      for (const row of rows) {
        const one = await runOnce(row)
        iterations.push(one)
        const status = statusOf(one)
        if (status === "cancelled" || status === "interrupted" || (options.bail && status !== "completed")) break
      }
      const first = iterations[0]!
      const title = first.kind === "run" ? first.workflow?.name ?? first.run.workflowId : first.projectName
      input = { kind: "iterations", title, iterations }
      passed = iterations.every((one) => statusOf(one) === "completed")
    }

    // -------- Report --------
    const color = io.stdout.isTTY === true && io.env["NO_COLOR"] === undefined
    if (options.reporters.has("cli")) io.stdout.write(mask(buildConsoleReport(input, color)))
    for (const [format, filePath] of [["junit", options.junitPath], ["html", options.htmlPath]] as const) {
      if (!options.reporters.has(format)) continue
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, mask(buildReport(format, input)), "utf8")
      if (options.reporters.has("cli")) io.stdout.write(`${format === "junit" ? "JUnit" : "HTML"} report: ${filePath}\n`)
    }
    return passed ? EXIT_PASSED : EXIT_FAILED
  } finally {
    await scheduler?.shutdown(0)
    await http?.close()
    database.close()
  }
}

/** `--timeout-request` and `--insecure` apply to every request, over each node's own setting. */
class CliHttp extends SafeHttp {
  public constructor(private readonly overrides: SafeFetchOptions, network: NetworkConfig) {
    super({ network })
  }

  public override safeFetch(url: string, init?: RequestInit, opts: SafeFetchOptions = {}): Promise<Response> {
    return super.safeFetch(url, init, { ...opts, ...this.overrides })
  }
}

/** `--iteration-data` rows, cut to `--iteration-count`; `--iteration-count` alone is that many empty rows. Undefined: a single run. */
function readIterationRows(options: CliOptions): IterationRow[] | undefined {
  if (options.iterationData === undefined) {
    return options.iterationCount === undefined ? undefined : Array.from({ length: options.iterationCount }, () => ({}))
  }
  let text: string
  try {
    if (fs.statSync(options.iterationData).size > MAX_ITERATION_DATA_BYTES) {
      throw new UsageError(`--iteration-data: ${options.iterationData} is larger than ${MAX_ITERATION_DATA_BYTES / 1024 / 1024} MB`)
    }
    text = fs.readFileSync(options.iterationData, "utf8")
  } catch (error) {
    if (error instanceof UsageError) throw error
    throw new UsageError(`--iteration-data: cannot read ${options.iterationData}: ${errorMessage(error)}`)
  }
  let rows: IterationRow[]
  try {
    rows = parseIterationData(text, options.iterationData)
  } catch (error) {
    throw new UsageError(`--iteration-data: ${errorMessage(error)}`)
  }
  return options.iterationCount === undefined ? rows : rows.slice(0, options.iterationCount)
}

/** A project bundle's workflow by name, or by its id in the bundle (ids are new once imported). */
function pickWorkflow(imported: readonly Workflow[], bundle: ProjectBundle, wanted: string): string {
  const name = bundle.workflows.find((workflow) => workflow.workflowId === wanted)?.name ?? wanted
  const matches = imported.filter((workflow) => workflow.name === name)
  if (matches.length === 1) return matches[0]!.workflowId
  const names = imported.map((workflow) => workflow.name).join(", ")
  throw new UsageError(`workflow '${wanted}' is ${matches.length === 0 ? "not in" : "ambiguous in"} the project (workflows: ${names})`)
}

function projectWorkflowIds(projectId: string, workspaceId: string, collections: CollectionRepository, workflows: WorkflowRepository): string[] {
  const members = workflows.listByCollection(workspaceId, projectId).items
  return planProjectRun(collections.getById(projectId)!, members).map((item) => item.workflowId)
}

/** Every `{{secrets.NAME}}` in the workflows that will run, Call Workflow targets included. */
function referencedSecrets(roots: readonly string[], workspaceId: string, workflows: WorkflowRepository): string[] {
  const names = new Set<string>()
  const seen = new Set<string>()
  const pending = [...roots]
  for (let workflowId = pending.pop(); workflowId !== undefined; workflowId = pending.pop()) {
    if (seen.has(workflowId)) continue
    seen.add(workflowId)
    const workflow = workflows.getByIdInWorkspace(workflowId, workspaceId)
    for (const node of workflow?.nodes ?? []) {
      for (const name of extractSecretRefsFromString(JSON.stringify(node.config ?? {}))) names.add(name)
      const callTarget: unknown = node.type === "workflow" ? node.config?.targetWorkflowId : undefined
      if (typeof callTarget === "string") pending.push(callTarget)
    }
  }
  return [...names].sort()
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function readJson(filePath: string): unknown {
  let text: string
  try {
    text = fs.readFileSync(filePath, "utf8")
  } catch (error) {
    throw new UsageError(`cannot read ${filePath}: ${errorMessage(error)}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${filePath} is not valid JSON: ${errorMessage(error)}`)
  }
}

/** A JSON object, or dotenv lines (`KEY=value`) when the file does not start with `{`. */
function readKeyValueFile(filePath: string, flag: string): Record<string, JsonValue> {
  let text: string
  try {
    text = fs.readFileSync(filePath, "utf8")
  } catch (error) {
    throw new UsageError(`${flag}: cannot read ${filePath}: ${errorMessage(error)}`)
  }
  if (!text.trimStart().startsWith("{")) return parseDotenv(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${flag}: ${filePath} is not valid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(parsed)) throw new UsageError(`${flag}: ${filePath} must hold a JSON object`)
  return parsed as Record<string, JsonValue>
}

function parsePairs(pairs: readonly string[], flag: string): [string, string][] {
  return pairs.map((pair) => {
    const separator = pair.indexOf("=")
    // Never echo the argument: for --secret it may be the value itself.
    if (separator <= 0) throw new UsageError(`${flag} expects KEY=value`)
    return [pair.slice(0, separator), pair.slice(separator + 1)]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
