/**
 * `--smoke-test`: start the app for real, prove the parts that only break once
 * packaged, and exit with the verdict. CI launches every packaged build this
 * way (`scripts/smoke-packaged.mjs`) on each OS, because a test suite run from
 * the source tree cannot see an addon left inside app.asar, a missing
 * `pty-host.cjs` or a renderer the app:// protocol fails to serve.
 *
 * Reaching this at all means the database opened and migrated and the keyfile
 * loaded: both run, and throw, before the window is created. What is left is
 * the window loading app://local/ and the PTY host forking and loading node-pty
 * far enough to start a process, and playwright-core loading from the package
 * the way a browser step loads it (no browser is launched: runners may have none).
 *
 * Without the switch nothing here runs, so it costs a normal launch nothing.
 */
export const SMOKE_TEST_SWITCH = "smoke-test"

export interface SmokeTestChecks {
  /** Settles with whether the window loaded app://local/. */
  readonly windowLoaded: Promise<boolean>
  /** Starts a throwaway PTY through the PTY host and resolves its pid. */
  readonly spawnPty: () => Promise<number>
  /** Loads the browser driver browser steps use and resolves the browser type it provides. */
  readonly loadBrowserDriver: () => Promise<string>
}

/** The process exit code: 0 when every check passed within `timeoutMs`. */
export async function runSmokeTest(
  checks: SmokeTestChecks,
  log: (message: string) => void,
  timeoutMs = 60_000,
): Promise<0 | 1> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  const pass = async (): Promise<void> => {
    if (!(await checks.windowLoaded)) throw new Error("the window did not load app://local/")
    log("window loaded app://local/")
    log(`PTY host started pid ${await checks.spawnPty()}`)
    log(`browser driver loaded (${await checks.loadBrowserDriver()})`)
  }
  try {
    await Promise.race([pass(), timeout])
    log("smoke test passed")
    return 0
  } catch (error) {
    log(`smoke test failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    clearTimeout(timer)
  }
}
