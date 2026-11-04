/** Lifecycle of an update check/download, surfaced to the Updates settings panel. */
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"

/**
 * How much the app is allowed to do on its own.
 *
 * - `automatic` — check on launch, download in the background, install on quit.
 * - `notify`    — check on launch, but a download only starts when the user
 *                 asks for it.
 * - `manual`    — no check on launch at all; only the Settings > Updates
 *                 "Check for updates" button reaches the network.
 *
 * `notify` is the default. OS code signing depends on release secrets, so a
 * build may have no Authenticode publisher to verify the downloaded installer
 * against; the update signature is the check that always runs, and the user
 * consenting to a specific version remains the last check before new code
 * runs. `automatic` is available for people who prefer it.
 */
export type UpdatePolicy = "automatic" | "notify" | "manual"

export const UPDATE_POLICIES: readonly UpdatePolicy[] = ["automatic", "notify", "manual"]

export const DEFAULT_UPDATE_POLICY: UpdatePolicy = "notify"

/** Narrows an arbitrary persisted string back to a policy. */
export function isUpdatePolicy(value: unknown): value is UpdatePolicy {
  return typeof value === "string" && (UPDATE_POLICIES as readonly string[]).includes(value)
}

/**
 * Current state of the update flow. On Windows (NSIS), Linux (AppImage) and a
 * signed macOS build `supportsAutoInstall` is true and the app can download and
 * stage an update itself, landing on "downloaded" once a restart can apply it.
 * Everywhere else (an unsigned macOS build, and the deb/rpm/pacman package
 * formats, which are managed by the OS package manager) it stops at "available"
 * with a `releaseUrl` to open manually.
 */
export interface UpdateStatus {
  readonly state: UpdateState
  readonly currentVersion: string
  readonly latestVersion: string | null
  readonly releaseUrl: string | null
  readonly downloadProgressPercent: number | null
  readonly supportsAutoInstall: boolean
  /** What the app is allowed to do unattended — see {@link UpdatePolicy}. */
  readonly policy: UpdatePolicy
  /** Epoch ms of the last completed check, so the panel can prove it ran. */
  readonly lastCheckedAt: number | null
  readonly error: string | null
}

/**
 * The `window.__APIWEAVE_UPDATES__` contract, declared once because both ends
 * of it are real code: preload builds the object, and the renderer's client
 * reads it. Declaring it twice let the two drift — which is what the defensive
 * `?.` on the newer methods in apiweaveClient.ts is compensating for.
 */
export interface UpdatesBridge {
  readonly getStatus: () => Promise<UpdateStatus>
  readonly check: () => Promise<UpdateStatus>
  readonly download: () => Promise<UpdateStatus>
  readonly setPolicy: (policy: UpdatePolicy) => Promise<UpdateStatus>
  readonly restartAndInstall: () => Promise<void>
  readonly openReleasePage: () => Promise<void>
  readonly openLogFile: () => Promise<void>
  readonly onStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
}
