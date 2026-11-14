/** What `pollUntil` saw: whether a check passed before the deadline, and the last error a check threw. */
export interface PollOutcome {
  readonly passed: boolean
  readonly lastError: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `check` until it returns true or `timeoutMs` passes, `intervalMs` apart.
 * `check` gets the time left, to bound its own waits. An error it throws counts
 * as "not yet" and is kept as `lastError`, unless `isFatal` says no later try
 * can succeed (an ambiguous locator, a closed browser): that one is rethrown.
 *
 * `playwright-core` has no `expect` (that lives in `@playwright/test`), so the
 * `expect-*` steps wait with this instead of a fixed delay.
 */
export async function pollUntil(
  timeoutMs: number,
  check: (remainingMs: number) => Promise<boolean>,
  isFatal: (error: unknown) => boolean,
  intervalMs = 100,
): Promise<PollOutcome> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = undefined
  for (;;) {
    try {
      if (await check(Math.max(1, deadline - Date.now()))) return { passed: true, lastError: undefined }
      lastError = undefined
    } catch (error) {
      if (isFatal(error)) throw error
      lastError = error
    }
    if (Date.now() + intervalMs > deadline) return { passed: false, lastError }
    await sleep(intervalMs)
  }
}
