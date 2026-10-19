import { rename } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"

/** What Windows answers a rename with while another program (an antivirus scan, an indexer) holds a file inside the folder. */
const HELD_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"])

/** About 1.5 s in all: long enough for a scan of a file git just wrote to let go. */
const RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 750]

const HELD_MESSAGE =
  "Another program is holding files in the downloaded repository, so it could not be moved into place. " +
  "Wait a moment, or close the program that may be using it, and try again."

export interface MoveIntoPlaceOptions {
  /** Defaults to `fs.promises.rename`. */
  readonly rename?: (from: string, to: string) => Promise<void>
  /** The wait before each retry. Defaults to {@link RETRY_DELAYS_MS}. */
  readonly retryDelaysMs?: readonly number[]
}

/**
 * Rename the freshly downloaded clone `from` to `to`, retrying while a file in
 * it is held, and then failing in plain words. Any other failure is thrown as
 * it is, at once.
 */
export async function moveIntoPlace(from: string, to: string, options: MoveIntoPlaceOptions = {}): Promise<void> {
  const move = options.rename ?? rename
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      await move(from, to)
      return
    } catch (error) {
      if (!HELD_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error
      const delay = delays[attempt]
      if (delay === undefined) throw new Error(HELD_MESSAGE, { cause: error })
      await sleep(delay)
    }
  }
}
