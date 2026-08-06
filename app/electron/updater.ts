import { app, shell } from "electron"
import { z } from "zod"
import { autoUpdater } from "electron-updater"
import type { ProgressInfo, UpdateInfo } from "electron-updater"
// Not re-exported from the package root, and the events map is what makes
// track() below type-safe. Type-only, so nothing is imported at runtime, and
// electron-updater is pinned to ~6.3.9 (see package.json) — a deep path is safe
// against a range it cannot cross.
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater"
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus"
import { DEFAULT_UPDATE_POLICY } from "@shared/types/UpdateStatus"
import { updaterLog } from "./logging"

// ---------------------------------------------------------------------------
// The update channel
//
// Every lookup in this file — both paths — goes through one documented GitHub
// URL form: `/releases/latest/download/<asset>`, a permalink to an asset on the
// newest non-prerelease release. Nothing parses HTML, an Atom feed, or a
// redirect shape, and nothing spends api.github.com's 60-request
// unauthenticated hourly budget (shared by every user behind one egress IP).
//
// That constraint is why `build.publish` in package.json lists
// electron-builder's *generic* provider ahead of `github`. Both halves of it
// are documented behaviour, not reverse-engineered:
//
//   - "Auto update relies only on the first provider in the list (you can
//     specify several publishers)" — builder-util-runtime's own docs on
//     `publishAutoUpdate`. So `app-update.yml` is written from the generic
//     entry, and the updater fetches `<url>/latest.yml` (`latest-linux.yml` on
//     Linux) rather than resolving versions itself.
//   - `github` stays second purely as the uploader. `scheduleUpload` returns
//     early for `provider === "generic"`, so nothing tries to publish to it.
//
// What this replaces: electron-updater's GitHub provider resolves versions by
// fetching `https://github.com/OWNER/REPO/releases.atom` and regex-extracting
// the tag from the first entry's `<link href>`. That is an undocumented web
// surface, and a broken update check is the one bug that cannot be shipped
// through the update channel.
//
// Two consequences worth knowing:
//
//   - `useMultipleRangeRequest: false` is set on the generic config. GitHub
//     redirects assets to a CDN that does not reliably serve multipart byte
//     ranges; sequential single-range requests still give differential updates.
//     (Left at its default, generic enables multi-range for any non-S3 URL.)
//   - The permalink tracks whatever release is newest, so a release published
//     while someone is mid-download shifts the bytes underneath them. The
//     sha512 in the manifest catches it, the download fails, and the next check
//     picks up the newer version. Rare and self-healing, but not impossible.
// ---------------------------------------------------------------------------

const REPO = "Kaysharp42/apiweave"

/** Ceiling on the "latest release" request, so a connection that opens and
 * then stalls can't strand the Updates panel in "checking" forever. */
const RELEASE_REQUEST_TIMEOUT_MS = 10_000

/** Delay on the launch check, to keep it clear of first paint. */
const STARTUP_CHECK_DELAY_MS = 5_000

/**
 * Gap between background checks while the app stays open. A desktop app lives
 * for days on a developer's second monitor, so a launch-only check means those
 * users are the last to hear about a release rather than the first.
 *
 * Six hours is chosen against the cost of being wrong in either direction:
 * missing a release by up to six hours is invisible to a user, and four
 * requests a day per install is nothing to a CDN-served static asset. Nothing
 * here is jittered because nothing here is a thundering herd — the timer is
 * anchored to each user's own launch time, not to a wall clock.
 */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/**
 * Opt-in escape hatch that makes the update path reachable before a release.
 *
 * Without it the download-and-install path first executes on a user's machine:
 * `app.isPackaged` is false in dev, so electron-updater's own `isUpdaterActive`
 * refuses to check and the code below short-circuits too. CI proves the release
 * *assets* exist, which is a different claim from the updater being able to use
 * them.
 *
 * With `APIWEAVE_DEV_UPDATES=1`, a dev run reads `dev-app-update.yml` from the
 * app directory instead of the packaged `app-update.yml` and otherwise behaves
 * exactly like a shipped build — same provider, same manifest parsing, same
 * signature and sha512 checks, same install-on-quit. Point it at a throwaway
 * repo and the whole path is testable in a loop.
 *
 * See docs/reference/release-and-updates.md for the procedure.
 */
function devUpdatesEnabled(): boolean {
  return process.env["APIWEAVE_DEV_UPDATES"] === "1"
}

/**
 * NSIS (Windows) and AppImage (Linux) can download and apply an update without
 * the binary being code-signed. macOS enforces Gatekeeper on self-update
 * (Squirrel.Mac requires a signed app, which this build isn't yet) and
 * deb/rpm/pacman installs are owned by the OS package manager, not the app —
 * both fall back to a manual "new version available" notice with a link to the
 * GitHub release instead of an in-app install.
 *
 * electron-updater is deliberately kept out of the esbuild bundle (see
 * esbuild.config.cjs) and pinned to the 6.3.x line, so it shares the one
 * builder-util-runtime that electron-builder 25 used to write latest.yml.
 */
export function platformSupportsAutoInstall(): boolean {
  if (process.platform === "win32") return true
  if (process.platform === "linux") return typeof process.env["APPIMAGE"] === "string"
  return false
}

function releaseUrl(version: string | null): string {
  return version === null
    ? `https://github.com/${REPO}/releases/latest`
    : `https://github.com/${REPO}/releases/tag/v${version}`
}

interface ParsedVersion {
  readonly core: readonly number[]
  readonly prerelease: readonly string[]
}

/** Splits `1.2.3-beta.1+build` into its numeric core and prerelease
 * identifiers. Build metadata is dropped — SemVer excludes it from
 * precedence. */
function parseVersion(version: string): ParsedVersion {
  const withoutBuild = version.split("+", 1)[0] ?? ""
  const dash = withoutBuild.indexOf("-")
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const prerelease = dash === -1 ? "" : withoutBuild.slice(dash + 1)
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prerelease === "" ? [] : prerelease.split("."),
  }
}

/**
 * SemVer §11 precedence for the prerelease segment: a version with no
 * prerelease outranks one that has it, numeric identifiers compare
 * numerically and rank below alphanumeric ones, and when every shared
 * identifier ties the longer list wins.
 */
// fallow-ignore-next-line complexity -- every branch here is a clause of SemVer §11 precedence; splitting them apart would hide the spec rather than simplify it, and the CRAP score is inflated because coverage is estimated from export references while this helper is exercised indirectly through isNewerVersion's tests
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue

    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/** True if `latest` has strictly higher SemVer precedence than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const x = a.core[i] ?? 0
    const y = b.core[i] ?? 0
    if (x !== y) return x > y
  }
  return comparePrerelease(a.prerelease, b.prerelease) > 0
}

/**
 * A manifest this project publishes as a release asset — see the "Publish the
 * version manifest" step in .github/workflows/desktop-release.yml.
 *
 * Unknown keys are ignored on purpose: a future release may add fields, and a
 * client shipped today has to keep working when it does. `version` is the one
 * field that can never change shape.
 */
const versionManifestSchema = z.object({
  version: z.string().min(1),
})

/**
 * The notice-only path's half of the update lookup: reads the newest published
 * version from `releases/latest/download/version.json`, the same documented
 * permalink base the generic provider uses for `latest.yml`.
 *
 * This exists rather than reusing `latest.yml` because the platforms on this
 * path have no manifest of their own to read. The release workflow deletes
 * `latest-mac.yml` on purpose — the two macOS jobs each publish a single-arch
 * manifest, so whichever lands last describes half the release — and reaching
 * for the *Windows* manifest just to learn a version number would couple macOS
 * updates to the win target's existence. `version.json` is platform-neutral by
 * construction, and the payload is ours: the thing most likely to change is the
 * file format, and we publish the file.
 *
 * Deleting this in favour of one shared manifest means building both macOS
 * arches in a single job so electron-builder emits a correct `latest-mac.yml`.
 * That is blocked on cross-arch native rebuilds (better-sqlite3), which is why
 * the jobs are split in the first place.
 */
export async function fetchLatestReleaseVersion(): Promise<string | null> {
  const response = await fetch(`https://github.com/${REPO}/releases/latest/download/version.json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
  })

  // 404 covers "no published release" and "the newest release predates this
  // manifest" alike. Neither is an error worth showing: there is nothing to
  // update to that we can name, and "Open release page" still works.
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

  const parsed = versionManifestSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error("The published version manifest is malformed.")
  return parsed.data.version
}

export interface UpdateManagerOptions {
  readonly onChange: (status: UpdateStatus) => void
  /** Persisted policy, or null to fall back to {@link DEFAULT_UPDATE_POLICY}. */
  readonly readPolicy?: () => UpdatePolicy | null
  readonly writePolicy?: (policy: UpdatePolicy) => void
}

/**
 * Single owner of update state for both the self-installing platforms
 * (electron-updater reading `latest.yml` through the generic provider) and the
 * notice-only fallback (a direct read of `version.json`). Both resolve against
 * the same documented permalink base — see the file header. Renderer-facing
 * status is always this same shape regardless of which path produced it.
 *
 * How much of that happens without the user asking is governed by
 * {@link UpdatePolicy}, persisted by the caller — see main.ts.
 */
export class UpdateManager {
  private status: UpdateStatus
  private readonly onChange: (status: UpdateStatus) => void
  private readonly writePolicy: (policy: UpdatePolicy) => void
  private readonly autoInstall: boolean

  /** Everything {@link dispose} has to undo: listeners on the electron-updater
   * singleton and the scheduler's timers. */
  private readonly disposers: Array<() => void> = []

  /**
   * True for the duration of a check the user did not ask for. Suppresses the
   * "checking" state and swallows failures into the log — see
   * {@link backgroundCheck}. An instance field rather than a parameter because
   * the electron-updater events that need to honour it arrive on listeners
   * registered once in the constructor.
   */
  private silentCheck = false

  constructor(options: UpdateManagerOptions) {
    this.onChange = options.onChange
    this.writePolicy = options.writePolicy ?? ((): void => undefined)
    this.autoInstall = platformSupportsAutoInstall()
    this.status = {
      state: "idle",
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseUrl: null,
      downloadProgressPercent: null,
      supportsAutoInstall: this.autoInstall,
      policy: options.readPolicy?.() ?? DEFAULT_UPDATE_POLICY,
      lastCheckedAt: null,
      error: null,
    }

    if (this.autoInstall) {
      // A download only ever begins unattended under the "automatic" policy.
      // Once one has begun — by policy or by an explicit click — applying it at
      // quit is what the user already consented to, so this stays on.
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.logger = updaterLog
      if (devUpdatesEnabled()) {
        // Makes electron-updater treat an unpackaged run as a real one. Nothing
        // else in the flow changes, which is the point of testing this way.
        autoUpdater.forceDevUpdateConfig = true
        updaterLog.warn("APIWEAVE_DEV_UPDATES=1 — using dev-app-update.yml")
      }
      this.applyPolicyToAutoUpdater()

      // Named handlers, registered and removed explicitly, so dispose() takes
      // back exactly what this instance added and nothing a future caller
      // registers alongside it.
      const onChecking = (): void => {
        if (this.silentCheck) return
        this.patch({ state: "checking", error: null })
      }
      const onAvailable = (info: UpdateInfo): void =>
        this.patch({
          // Under "automatic" electron-updater has already started fetching;
          // otherwise this is a notice and `download()` is the user's next step.
          state: this.status.policy === "automatic" ? "downloading" : "available",
          latestVersion: info.version,
          releaseUrl: releaseUrl(info.version),
          downloadProgressPercent: this.status.policy === "automatic" ? 0 : null,
          lastCheckedAt: Date.now(),
        })
      const onNotAvailable = (info: UpdateInfo): void =>
        this.patch({ state: "not-available", latestVersion: info.version, lastCheckedAt: Date.now() })
      const onProgress = (progress: ProgressInfo): void =>
        this.patch({ downloadProgressPercent: Math.round(progress.percent) })
      const onDownloaded = (info: UpdateInfo): void =>
        this.patch({ state: "downloaded", latestVersion: info.version, downloadProgressPercent: 100 })
      const onError = (error: Error): void => {
        if (this.silentCheck) {
          // A check the user never asked for must not paint an error they
          // cannot act on. A closed lid or a captive-portal wifi is not a
          // problem report; the log is where this belongs.
          updaterLog.warn(`background check failed: ${error.message}`)
          return
        }
        this.patch({ state: "error", error: error.message, downloadProgressPercent: null })
      }

      this.track("checking-for-update", onChecking)
      this.track("update-available", onAvailable)
      this.track("update-not-available", onNotAvailable)
      this.track("download-progress", onProgress)
      this.track("update-downloaded", onDownloaded)
      this.track("error", onError)
    }
  }

  /**
   * Registers one electron-updater listener and records how to remove it, so
   * `on` and `off` are named once instead of in two lists that have to agree.
   * Two lists is how a handler ends up registered but never removed.
   */
  private track<E extends keyof AppUpdaterEvents>(event: E, handler: AppUpdaterEvents[E]): void {
    autoUpdater.on(event, handler)
    this.disposers.push(() => autoUpdater.off(event, handler))
  }

  /**
   * Starts the unattended schedule: one check just after launch, then one every
   * {@link RECHECK_INTERVAL_MS} for as long as the app stays open. Both go
   * through {@link backgroundCheck}, so both are silent and both respect the
   * "manual" policy.
   */
  start(): void {
    const startupTimer = setTimeout(() => void this.backgroundCheck(), STARTUP_CHECK_DELAY_MS)
    const recheckTimer = setInterval(() => void this.backgroundCheck(), RECHECK_INTERVAL_MS)
    this.disposers.push(() => {
      clearTimeout(startupTimer)
      clearInterval(recheckTimer)
    })
  }

  /**
   * Undoes every listener and timer this instance installed. Idempotent.
   *
   * The process exiting would release all of it anyway, so this is not about
   * reclaiming resources in a running app. It exists because `autoUpdater` is a
   * module-level singleton shared by every manager ever constructed: without
   * this, each new instance stacks another set of handlers on it, and they all
   * fire, each patching its own dead copy of the status. That is invisible
   * while exactly one manager exists for the process lifetime and immediate the
   * moment that stops being true — which it already is under test, where every
   * case builds one.
   */
  dispose(): void {
    // splice() empties the list as it reads it, so a second call is a no-op.
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.onChange(this.status)
  }

  private applyPolicyToAutoUpdater(): void {
    if (!this.autoInstall) return
    autoUpdater.autoDownload = this.status.policy === "automatic"
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  /**
   * Switches the policy and persists it. Tightening to "manual" doesn't cancel
   * a download already in flight — there's nothing to gain from throwing away
   * bytes already on disk — but loosening to "automatic" picks up an update
   * that was sitting in "available" waiting on a click.
   */
  async setPolicy(policy: UpdatePolicy): Promise<UpdateStatus> {
    if (policy === this.status.policy) return this.status
    this.writePolicy(policy)
    this.patch({ policy })
    this.applyPolicyToAutoUpdater()
    if (policy === "automatic" && this.autoInstall && this.status.state === "available") {
      return this.download()
    }
    return this.status
  }

  /**
   * A check nobody asked for: the launch check and every recurring one behind
   * {@link start}.
   *
   * Silent in both directions. It never shows "checking", because a spinner
   * appearing in a panel the user didn't open is noise; and it never shows an
   * error, because the common reason a background check fails is that the
   * machine is briefly offline, which is not a thing to report. Failures go to
   * the log. Finding an update *is* reported — that is the whole point.
   */
  async backgroundCheck(): Promise<UpdateStatus> {
    // "manual" means no update traffic the user did not ask for.
    if (this.status.policy === "manual") return this.status
    // Mid-download, or already staged for restart, is a strictly better place
    // to be than anything a fresh check could tell us. Re-checking would at
    // best restate it and at worst restart a download that is already running.
    if (this.status.state === "downloading" || this.status.state === "downloaded") return this.status
    return this.runCheck(true)
  }

  /** Explicit user-triggered check. Reports whatever it finds, including
   * failures — the user is looking at the panel and waiting for an answer. */
  async check(): Promise<UpdateStatus> {
    return this.runCheck(false)
  }

  private async runCheck(silent: boolean): Promise<UpdateStatus> {
    if (!app.isPackaged && !devUpdatesEnabled()) {
      // Dev runs have no app-update.yml and nothing published to compare
      // against — unless the dev override is on, in which case the whole point
      // is to let the real path run.
      this.patch({ state: "not-available", error: null, lastCheckedAt: Date.now() })
      return this.status
    }

    this.silentCheck = silent
    try {
      return this.autoInstall ? await this.checkViaAutoUpdater(silent) : await this.checkLatestRelease(silent)
    } finally {
      // Cleared as soon as the check resolves, not when a download it may have
      // kicked off finishes: a download failure is always worth surfacing.
      this.silentCheck = false
    }
  }

  /**
   * A check that failed. Silent ones only reach the log — see
   * {@link backgroundCheck} for why. Both check paths end here so that choice
   * is made in exactly one place.
   */
  private reportCheckFailure(silent: boolean, message: string): void {
    if (silent) updaterLog.warn(`background check failed: ${message}`)
    else this.patch({ state: "error", error: message, lastCheckedAt: Date.now() })
  }

  private async checkViaAutoUpdater(silent: boolean): Promise<UpdateStatus> {
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.reportCheckFailure(silent, error instanceof Error ? error.message : String(error))
    }
    return this.status
  }

  /**
   * Downloads an update the user has been notified about. Only reachable on the
   * self-installing platforms, and only from "available" — under the
   * "automatic" policy electron-updater has already done this itself.
   */
  async download(): Promise<UpdateStatus> {
    if (!this.autoInstall || this.status.state !== "available") return this.status
    this.patch({ state: "downloading", downloadProgressPercent: 0, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.patch({
        state: "error",
        error: error instanceof Error ? error.message : String(error),
        downloadProgressPercent: null,
      })
    }
    return this.status
  }

  private async checkLatestRelease(silent: boolean): Promise<UpdateStatus> {
    if (!silent) this.patch({ state: "checking", error: null })
    try {
      const latestVersion = await fetchLatestReleaseVersion()
      if (latestVersion !== null && isNewerVersion(latestVersion, app.getVersion())) {
        this.patch({
          state: "available",
          latestVersion,
          releaseUrl: releaseUrl(latestVersion),
          lastCheckedAt: Date.now(),
        })
      } else {
        this.patch({ state: "not-available", latestVersion, lastCheckedAt: Date.now() })
      }
    } catch (error) {
      // AbortSignal.timeout rejects with a bare "signal is aborted" style
      // DOMException, which tells the user nothing about what timed out.
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? `GitHub did not respond within ${RELEASE_REQUEST_TIMEOUT_MS / 1000}s.`
          : error instanceof Error
            ? error.message
            : String(error)
      this.reportCheckFailure(silent, message)
    }
    return this.status
  }

  /** Only meaningful once `state === "downloaded"` (win/AppImage path). */
  restartAndInstall(): void {
    if (this.status.state === "downloaded") {
      autoUpdater.quitAndInstall()
    }
  }

  /** Opens the release page in the system browser — the only path on
   * platforms that don't self-install, and a safe fallback everywhere else. */
  openReleasePage(): void {
    void shell.openExternal(this.status.releaseUrl ?? releaseUrl(this.status.latestVersion))
  }
}
