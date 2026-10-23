import { execFile, type ChildProcess, type ExecFileException } from "node:child_process"
import type { GitCommand, GitCredential } from "./git_types"

const LOCAL_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 300_000
const NETWORK_COMMANDS: ReadonlySet<GitCommand> = new Set<GitCommand>(["fetch", "push", "clone"])

export const DEFAULT_TIMEOUTS_MS = { local: LOCAL_TIMEOUT_MS, network: NETWORK_TIMEOUT_MS } as const

/** `show` and `log` stream a whole file or history, so the buffer is far above execFile's 1 MiB. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Variables that point git at a repository other than the one in `cwd`, as a parent git process (a hook) leaves them. */
const REPOSITORY_LOCATION_VARIABLES = [
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
] as const

export function timeoutFor(command: GitCommand, overrides: Partial<Record<GitCommand, number>>): number {
  return overrides[command] ?? (NETWORK_COMMANDS.has(command) ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS)
}

/** The configuration every invocation carries, ahead of the subcommand. */
export function gitConfigArgs(hooksDir: string): string[] {
  return [
    "-c",
    `core.hooksPath=${hooksDir}`,
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.fsmonitor=false",
    // A link a repository carries is checked out as a plain file holding its
    // target, so no clone or pull can make the app write through it.
    "-c",
    "core.symlinks=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "credential.interactive=auto",
    // The author is the one the user configured, or none: never a name and
    // address guessed from the login and host name.
    "-c",
    "user.useConfigOnly=true",
  ]
}

/**
 * The credential helper a call with a credential runs, through the `sh` git
 * starts `!` helpers with (Git for Windows' bundled one on Windows). It reads
 * everything from variables set on that one git process
 * ({@link credentialEnvironment}), so the token is never in argv — this text
 * is, and holds none — nor in a file. It answers only `get`, and only when
 * git asks for the protocol and host the credential is for: a redirect to
 * another host, or to plain http, gets nothing, and git fails rather than
 * sending the token there. `store` and `erase` do nothing, so the token is
 * never handed to a keychain either.
 */
const CREDENTIAL_HELPER = [
  "!f() {",
  'test "$1" = get || return 0;',
  "p=; h=;",
  'while IFS= read -r line; do case "$line" in protocol=*) p=${line#protocol=};; host=*) h=${line#host=};; esac; done;',
  'test "$p" = "$APIWEAVE_GIT_PROTOCOL" && test "$h" = "$APIWEAVE_GIT_HOST" || return 0;',
  'printf "username=%s\\npassword=%s\\n" "$APIWEAVE_GIT_USERNAME" "$APIWEAVE_GIT_PASSWORD";',
  "}; f",
].join(" ")

/**
 * Ahead of a call's subcommand when it carries a credential. An empty
 * `credential.helper` empties the list of helpers git has read so far — the
 * system's, the user's, the repository's, and the URL-scoped ones such as
 * `credential.https://github.com.helper` (`gh auth git-credential`), which git
 * collects into the same list — and `-c` is read after every file. So
 * {@link CREDENTIAL_HELPER} is the only helper left to answer.
 */
export function credentialConfigArgs(): string[] {
  return ["-c", "credential.helper=", "-c", `credential.helper=${CREDENTIAL_HELPER}`]
}

/** What {@link CREDENTIAL_HELPER} reads, for the one git process that carries the credential (and its transport and helper children). */
export function credentialEnvironment(credential: GitCredential): NodeJS.ProcessEnv {
  return {
    APIWEAVE_GIT_PROTOCOL: credential.protocol,
    APIWEAVE_GIT_HOST: credential.host,
    APIWEAVE_GIT_USERNAME: credential.username,
    APIWEAVE_GIT_PASSWORD: credential.password,
  }
}

/** Every form the credential could be echoed in — the token, and the Basic authorization it becomes — for an error to scrub. */
export function credentialSecrets(credential: GitCredential): string[] {
  return [credential.password, Buffer.from(`${credential.username}:${credential.password}`).toString("base64")]
}

/** What git inherits: the caller's environment, minus repository redirection, plus the settings that keep it quiet, literal and English. */
export function gitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const name of REPOSITORY_LOCATION_VARIABLES) {
    delete env[name]
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    // Every path an argument names is a path, never a glob or `:(magic)`.
    GIT_LITERAL_PATHSPECS: "1",
    // A cloned `.gitattributes` naming `filter=lfs` must not run the LFS smudge filter.
    GIT_LFS_SKIP_SMUDGE: "1",
    LC_ALL: "C",
  }
}

export interface GitExecOptions {
  readonly cwd: string | undefined
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  /** Written to git's stdin before it is closed: what a batch command reads. Nothing by default. */
  readonly input?: string | undefined
  /** `args` is an escaped cmd.exe command line (`spawnCommandFor` on a `.cmd` shim), passed as it is. */
  readonly verbatim?: boolean
  /** Told each piece of stderr as it arrives, for a process whose output matters before it exits. */
  readonly onStderr?: ((text: string) => void) | undefined
  /** Aborting it kills the process tree, as the timeout does, and resolves `cancelled`. */
  readonly signal?: AbortSignal | undefined
}

export interface GitExecOutcome {
  /** `cancelled` only when the caller's `signal` aborted it; git itself is never given one. */
  readonly status: "exited" | "timeout" | "cancelled" | "spawn_failed"
  readonly exitCode: number | undefined
  /** The errno string (`ENOENT`) when git could not be started. */
  readonly errorCode: string | undefined
  readonly stdout: string
  readonly stderr: string
}

function outcomeOf(error: ExecFileException | null, stdout: string, stderr: string): GitExecOutcome {
  if (error === null) {
    return { status: "exited", exitCode: 0, errorCode: undefined, stdout, stderr }
  }
  if (typeof error.code === "number") {
    return { status: "exited", exitCode: error.code, errorCode: undefined, stdout, stderr }
  }
  return { status: "spawn_failed", exitCode: undefined, errorCode: String(error.code ?? error.name), stdout, stderr }
}

/** How long to wait, after a kill, for the process to be gone before reporting the timeout anyway. */
const KILL_GRACE_MS = 5_000

/**
 * How long the whole terminate-and-wait stage may take. A `taskkill` that never
 * calls back, or a child that survives its kill, must not leave the call
 * pending: the timeout is reported either way.
 */
const TERMINATE_TIMEOUT_MS = KILL_GRACE_MS + 3_000

/** Resolve once `work` settles, or after `ms`, whichever comes first. A kill that hangs must not hold the caller. */
export function awaitWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const expiry = setTimeout(resolve, ms)
    const done = (): void => {
      clearTimeout(expiry)
      resolve()
    }
    void work.then(done, done)
  })
}

/**
 * Windows does not forward a kill to git's children, so `git-remote-http` would
 * outlive `git`, holding the repository directory open. `taskkill /T` takes the
 * whole tree, and has to run before the parent is gone to find it.
 */
function taskkillTree(child: ChildProcess): Promise<boolean> {
  if (process.platform !== "win32" || child.pid === undefined) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
      resolve(error === null)
    })
  })
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const grace = setTimeout(resolve, KILL_GRACE_MS)
    child.once("exit", () => {
      clearTimeout(grace)
      resolve()
    })
  })
}

/** Kill git, tree included, and wait for it to go: a killed git still running holds `index.lock`, and the next command would fail on it. */
async function terminateAndWait(child: ChildProcess): Promise<void> {
  if (!(await taskkillTree(child))) {
    child.kill()
  }
  await waitForExit(child)
}

/**
 * Run git — or a host's CLI, `gh` or `glab` — without a shell. Resolves for
 * every outcome and never rejects, so the caller decides what a non-zero exit
 * means.
 *
 * The timeout, and a cancel through `signal`, resolve on their own path
 * instead of waiting for execFile's callback: a `git-remote-http` helper
 * inherits the stderr pipe, so a pipe left open would keep the callback from
 * ever coming.
 */
export function execGit(file: string, args: readonly string[], options: GitExecOptions): Promise<GitExecOutcome> {
  return new Promise((resolve) => {
    let stopped = false
    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
        windowsHide: true,
        windowsVerbatimArguments: options.verbatim === true,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", cancel)
        if (!stopped) {
          resolve(outcomeOf(error, stdout, stderr))
        }
      },
    )
    const { onStderr } = options
    if (onStderr !== undefined) child.stderr?.on("data", (chunk: string | Buffer) => onStderr(String(chunk)))
    // Closing stdin keeps a stray read from waiting for input; only a batch command is given any.
    child.stdin?.end(options.input)
    const stop = (status: "timeout" | "cancelled"): void => {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", cancel)
      child.stdout?.destroy()
      child.stderr?.destroy()
      // Bounded: the terminate stage reports the outcome even if the kill never completes.
      void awaitWithin(terminateAndWait(child), TERMINATE_TIMEOUT_MS).then(() =>
        resolve({ status, exitCode: undefined, errorCode: undefined, stdout: "", stderr: "" }),
      )
    }
    const cancel = (): void => stop("cancelled")
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs)
    if (options.signal?.aborted === true) cancel()
    else options.signal?.addEventListener("abort", cancel, { once: true })
  })
}