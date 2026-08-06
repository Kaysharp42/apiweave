import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { autoUpdater } from "electron-updater"
import { isNewerVersion, platformSupportsAutoInstall, summarizeUpdaterError, UpdateManager } from "../updater"
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus"

const CURRENT_VERSION = "0.6.3"

const electronApp = { isPackaged: true, getVersion: () => CURRENT_VERSION }
const mockOpenExternal = vi.fn()

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronApp.isPackaged
    },
    getVersion: () => electronApp.getVersion(),
  },
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}))

// electron-log reaches into app paths and the ipcMain singleton at import time,
// neither of which exist here. The logger's only contract that matters to these
// tests is that suppressed background failures land somewhere.
// vi.hoisted, because the factory below is lifted above ordinary declarations
// and reads this one eagerly rather than from inside a function body.
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock("../logging", () => ({
  updaterLog: mockLog,
  logFilePath: () => "/logs/main.log",
  revealLogFile: vi.fn(),
}))

// The auto-install path is exercised through these listeners rather than a real
// download: UpdateManager's contract is that every electron-updater event maps
// onto one renderer-facing status shape.
//
// A Set per event, not one handler per event, because `autoUpdater` is a
// singleton every manager shares — modelling it as "last registration wins"
// would hide exactly the listener accumulation that dispose() exists to
// prevent.
const updaterListeners = new Map<string, Set<(payload: unknown) => void>>()

function emit(event: string, payload?: unknown): void {
  for (const handler of updaterListeners.get(event) ?? []) handler(payload)
}

/** How many live listeners the shared singleton is carrying. */
function listenerCount(): number {
  let total = 0
  for (const handlers of updaterListeners.values()) total += handlers.size
  return total
}

vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: null,
    forceDevUpdateConfig: false,
    on: (event: string, handler: (payload: unknown) => void) => {
      const handlers = updaterListeners.get(event) ?? new Set()
      handlers.add(handler)
      updaterListeners.set(event, handlers)
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      updaterListeners.get(event)?.delete(handler)
    },
    // The real one emits this before it hits the network, which is what the
    // "checking" state hangs off — so the mock has to as well, or the tests
    // that assert a background check stays silent would pass for free.
    checkForUpdates: vi.fn(() => {
      emit("checking-for-update")
      return Promise.resolve(null)
    }),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn(),
  },
}))

/** process.platform is read-only, so swap the descriptor and restore it after. */
function withPlatform(platform: NodeJS.Platform, appImage: string | undefined, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, "platform")
  const originalAppImage = process.env["APPIMAGE"]
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  if (appImage === undefined) delete process.env["APPIMAGE"]
  else process.env["APPIMAGE"] = appImage
  try {
    run()
  } finally {
    if (original !== undefined) Object.defineProperty(process, "platform", original)
    if (originalAppImage === undefined) delete process.env["APPIMAGE"]
    else process.env["APPIMAGE"] = originalAppImage
  }
}

interface Harness {
  readonly manager: UpdateManager
  readonly pushed: UpdateStatus[]
  readonly written: UpdatePolicy[]
}

function createManager(platform: NodeJS.Platform, policy: UpdatePolicy | null): Harness {
  const pushed: UpdateStatus[] = []
  const written: UpdatePolicy[] = []
  let manager!: UpdateManager
  withPlatform(platform, undefined, () => {
    manager = new UpdateManager({
      onChange: (status) => pushed.push(status),
      readPolicy: () => policy,
      writePolicy: (next) => written.push(next),
    })
  })
  return { manager, pushed, written }
}

/** Builds a manager on the notice-only path (macOS) and records every push. */
function createNoticeOnlyManager(): Harness {
  return createManager("darwin", null)
}

/** A response from the published `version.json` release asset. */
function manifestResponse(body: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

const MANIFEST_URL = "https://github.com/Kaysharp42/apiweave/releases/latest/download/version.json"

beforeEach(() => {
  electronApp.isPackaged = true
  updaterListeners.clear()
  mockOpenExternal.mockClear()
  mockLog.warn.mockClear()
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  vi.mocked(autoUpdater.checkForUpdates).mockClear()
  vi.mocked(autoUpdater.downloadUpdate).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("isNewerVersion", () => {
  it("compares the numeric core left to right", () => {
    expect(isNewerVersion("0.7.0", "0.6.3")).toBe(true)
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true)
    expect(isNewerVersion("0.6.10", "0.6.9")).toBe(true)
    expect(isNewerVersion("0.6.3", "0.6.3")).toBe(false)
    expect(isNewerVersion("0.6.2", "0.6.3")).toBe(false)
  })

  it("treats a missing trailing segment as zero", () => {
    expect(isNewerVersion("0.7", "0.6.3")).toBe(true)
    expect(isNewerVersion("0.6.0", "0.6")).toBe(false)
  })

  it("ranks a release above its own prereleases", () => {
    // The bug this guards: parsing "0.7.0-beta.1" as a plain dotted-numeric
    // string yielded 0.7.0, so a beta looked like the GA release.
    expect(isNewerVersion("0.7.0", "0.7.0-beta.1")).toBe(true)
    expect(isNewerVersion("0.7.0-beta.1", "0.7.0")).toBe(false)
    expect(isNewerVersion("0.7.0-beta.1", "0.6.3")).toBe(true)
  })

  it("orders prerelease identifiers by SemVer precedence", () => {
    expect(isNewerVersion("0.7.0-beta.2", "0.7.0-beta.1")).toBe(true)
    expect(isNewerVersion("0.7.0-beta.10", "0.7.0-beta.2")).toBe(true)
    expect(isNewerVersion("0.7.0-beta.1", "0.7.0-alpha.9")).toBe(true)
    expect(isNewerVersion("0.7.0-beta.1", "0.7.0-beta")).toBe(true)
    expect(isNewerVersion("0.7.0-beta", "0.7.0-beta.1")).toBe(false)
    // Numeric identifiers always rank below alphanumeric ones.
    expect(isNewerVersion("0.7.0-alpha", "0.7.0-1")).toBe(true)
  })

  it("ignores build metadata", () => {
    expect(isNewerVersion("0.6.3+build.9", "0.6.3")).toBe(false)
    expect(isNewerVersion("0.7.0+build.1", "0.6.3+build.99")).toBe(true)
  })
})

describe("summarizeUpdaterError", () => {
  it("collapses an HttpError dump to the status code and a pointer to the log", () => {
    // The shape electron-updater's GenericProvider actually throws: status,
    // request line, and every response header flattened into one string.
    const dump =
      'Cannot find channel "beta.yml" update info: HttpError: 404 "method: GET url: ' +
      "https://github.com/Kaysharp42/apiweave/releases/download/v0.6.3/beta.yml\\n\\n" +
      'Please double check that your authentication token is correct. Due to security ' +
      'reasons, actual status maybe not reported, but 404.\\n" ' +
      "Headers: { ... } at createHttpError (...) at ElectronHttpExecutor.handleResponse (...)"
    expect(summarizeUpdaterError(dump)).toBe(
      "Couldn't reach the update server (HTTP 404). See the update log for details.",
    )
  })

  it("passes short, already-human messages through unchanged", () => {
    expect(summarizeUpdaterError("net::ERR_CONNECTION_RESET")).toBe("net::ERR_CONNECTION_RESET")
    expect(summarizeUpdaterError("GitHub returned 500")).toBe("GitHub returned 500")
  })

  it("takes only the first line of a multi-line message with no HTTP status", () => {
    expect(summarizeUpdaterError("first line\nsecond line\nthird line")).toBe("first line")
  })

  it("caps an unexpectedly long single-line message rather than dumping it whole", () => {
    const long = "x".repeat(200)
    const result = summarizeUpdaterError(long)
    expect(result).toBe(`${"x".repeat(160)}…`)
    expect(result.length).toBe(161)
  })
})

describe("platformSupportsAutoInstall", () => {
  it("is true on Windows", () => {
    withPlatform("win32", undefined, () => {
      expect(platformSupportsAutoInstall()).toBe(true)
    })
  })

  it("is true on Linux only when running as an AppImage", () => {
    withPlatform("linux", "/tmp/APIWeave.AppImage", () => {
      expect(platformSupportsAutoInstall()).toBe(true)
    })
    // A deb/rpm/pacman install is owned by the OS package manager.
    withPlatform("linux", undefined, () => {
      expect(platformSupportsAutoInstall()).toBe(false)
    })
  })

  it("is false on macOS, where Gatekeeper blocks an unsigned self-update", () => {
    withPlatform("darwin", undefined, () => {
      expect(platformSupportsAutoInstall()).toBe(false)
    })
  })
})

describe("UpdateManager on the notice-only path", () => {
  it("reads the newest version from the published manifest", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" })))
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("available")
    expect(status.latestVersion).toBe("0.7.0")
    expect(status.supportsAutoInstall).toBe(false)
    expect(status.releaseUrl).toBe("https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.0")
  })

  it("uses the documented asset permalink, not api.github.com and not a scraped page", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" })))
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createNoticeOnlyManager()
    await manager.check()

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    // api.github.com is rate-limited per IP; the HTML page and the Atom feed are
    // both undocumented shapes that a GitHub change could break.
    expect(url).not.toContain("api.github.com")
    expect(url).not.toContain(".atom")
    expect(url).toBe(MANIFEST_URL)
  })

  it("ignores fields a future release adds, so an old client keeps working", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          manifestResponse({
            schema: 2,
            version: "0.7.0",
            tag: "v0.7.0",
            minimumVersion: "0.5.0",
            channels: { beta: "0.8.0-beta.1" },
          }),
        ),
      ),
    )

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("available")
    expect(status.latestVersion).toBe("0.7.0")
  })

  it("reports not-available when the latest release is the running version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: CURRENT_VERSION }))),
    )

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("not-available")
    expect(status.latestVersion).toBe(CURRENT_VERSION)
  })

  it("stays quiet when no release carries the manifest yet", async () => {
    // 404 covers both "no published release" and a release predating the
    // manifest. Neither is worth an error the user can't act on.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(manifestResponse({}, 404))))

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("not-available")
    expect(status.latestVersion).toBeNull()
    expect(status.error).toBeNull()
  })

  it("surfaces a failing response as an error rather than staying in checking", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(manifestResponse({}, 503))))

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("error")
    expect(status.error).toContain("503")
  })

  it("rejects a malformed manifest instead of trusting it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(manifestResponse({ schema: 1 }))))

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("error")
    expect(status.error).toContain("malformed")
  })

  it("names the timeout when the request is aborted", async () => {
    const timeout = new Error("The operation was aborted due to timeout")
    timeout.name = "TimeoutError"
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(timeout)))

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(status.state).toBe("error")
    expect(status.error).toBe("GitHub did not respond within 10s.")
  })

  it("passes an abort signal so a stalled connection cannot hang the check", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" })))
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createNoticeOnlyManager()
    await manager.check()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("skips the network entirely in an unpackaged dev run", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    electronApp.isPackaged = false

    const { manager } = createNoticeOnlyManager()
    const status = await manager.check()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(status.state).toBe("not-available")
  })

  it("opens the latest-release page when no specific version is known", () => {
    const { manager } = createNoticeOnlyManager()
    manager.openReleasePage()
    expect(mockOpenExternal).toHaveBeenCalledWith("https://github.com/Kaysharp42/apiweave/releases/latest")
  })

  it("records when the check finished, whatever the outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))

    const { manager } = createNoticeOnlyManager()
    expect(manager.getStatus().lastCheckedAt).toBeNull()
    const status = await manager.check()

    expect(status.state).toBe("error")
    expect(status.lastCheckedAt).toBeTypeOf("number")
  })
})

describe("UpdateManager on the auto-installing path", () => {
  it("maps the electron-updater lifecycle onto renderer status", () => {
    const { manager } = createManager("win32", "automatic")
    expect(manager.getStatus().supportsAutoInstall).toBe(true)

    emit("update-available", { version: "0.7.0" })
    expect(manager.getStatus()).toMatchObject({
      state: "downloading",
      latestVersion: "0.7.0",
      downloadProgressPercent: 0,
    })

    emit("download-progress", { percent: 42.7 })
    expect(manager.getStatus().downloadProgressPercent).toBe(43)

    emit("update-downloaded", { version: "0.7.0" })
    expect(manager.getStatus()).toMatchObject({ state: "downloaded", downloadProgressPercent: 100 })
  })

  it("clears stale progress when the check errors out", () => {
    const { manager } = createManager("win32", "automatic")
    emit("update-available", { version: "0.7.0" })
    emit("download-progress", { percent: 60 })

    emit("error", new Error("net::ERR_CONNECTION_RESET"))

    expect(manager.getStatus()).toMatchObject({
      state: "error",
      error: "net::ERR_CONNECTION_RESET",
      downloadProgressPercent: null,
    })
  })

  it("shows a plain sentence instead of electron-updater's raw HttpError dump", () => {
    const { manager } = createManager("win32", "notify")

    emit(
      "error",
      new Error(
        'Cannot find channel "beta.yml" update info: HttpError: 404 "method: GET url: ' +
          "https://github.com/Kaysharp42/apiweave/releases/download/v0.6.3/beta.yml\\n\\n" +
          'Please double check..." Headers: { ... } at createHttpError (...)',
      ),
    )

    expect(manager.getStatus().error).toBe(
      "Couldn't reach the update server (HTTP 404). See the update log for details.",
    )
  })
})

describe("UpdateManager policy", () => {
  it("defaults to notify, so an unsigned installer is never fetched unattended", () => {
    const { manager } = createManager("win32", null)
    expect(manager.getStatus().policy).toBe("notify")
    expect(autoUpdater.autoDownload).toBe(false)
  })

  it("stops at a notice instead of downloading under notify", () => {
    const { manager } = createManager("win32", "notify")

    emit("update-available", { version: "0.7.0" })

    expect(manager.getStatus()).toMatchObject({
      state: "available",
      latestVersion: "0.7.0",
      downloadProgressPercent: null,
    })
    expect(vi.mocked(autoUpdater.downloadUpdate)).not.toHaveBeenCalled()
  })

  it("lets electron-updater download on its own only under automatic", () => {
    createManager("win32", "automatic")
    expect(autoUpdater.autoDownload).toBe(true)
  })

  it("still applies an already-started download at quit", () => {
    // Whether the download began by policy or by an explicit click, the user
    // has consented to this version — throwing it away at quit helps nobody.
    createManager("win32", "notify")
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it("downloads on request once a notice has been raised", async () => {
    const { manager } = createManager("win32", "notify")
    emit("update-available", { version: "0.7.0" })

    await manager.download()

    expect(vi.mocked(autoUpdater.downloadUpdate)).toHaveBeenCalledOnce()
    expect(manager.getStatus().state).toBe("downloading")
  })

  it("ignores a download request when no update is pending", async () => {
    const { manager } = createManager("win32", "notify")
    await manager.download()
    expect(vi.mocked(autoUpdater.downloadUpdate)).not.toHaveBeenCalled()
    expect(manager.getStatus().state).toBe("idle")
  })

  it("surfaces a failed download instead of hanging in downloading", async () => {
    vi.mocked(autoUpdater.downloadUpdate).mockRejectedValueOnce(new Error("net::ERR_FAILED"))
    const { manager } = createManager("win32", "notify")
    emit("update-available", { version: "0.7.0" })

    await manager.download()

    expect(manager.getStatus()).toMatchObject({
      state: "error",
      error: "net::ERR_FAILED",
      downloadProgressPercent: null,
    })
  })

  it("persists a policy change and reconfigures electron-updater", async () => {
    const { manager, written } = createManager("win32", "notify")

    await manager.setPolicy("automatic")

    expect(written).toEqual(["automatic"])
    expect(manager.getStatus().policy).toBe("automatic")
    expect(autoUpdater.autoDownload).toBe(true)
  })

  it("does not rewrite the setting when it hasn't changed", async () => {
    const { manager, written } = createManager("win32", "notify")
    await manager.setPolicy("notify")
    expect(written).toEqual([])
  })

  it("picks up a waiting notice when the user switches to automatic", async () => {
    const { manager } = createManager("win32", "notify")
    emit("update-available", { version: "0.7.0" })

    await manager.setPolicy("automatic")

    expect(vi.mocked(autoUpdater.downloadUpdate)).toHaveBeenCalledOnce()
    expect(manager.getStatus().state).toBe("downloading")
  })

  it("makes no network request on launch under manual", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const { manager } = createManager("win32", "manual")

    await manager.backgroundCheck()

    expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(manager.getStatus().state).toBe("idle")
  })

  it("still checks on demand under manual", async () => {
    const { manager } = createManager("win32", "manual")
    await manager.check()
    expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledOnce()
  })

  it("checks on launch under notify", async () => {
    const { manager } = createManager("win32", "notify")
    await manager.backgroundCheck()
    expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledOnce()
  })
})

describe("UpdateManager background checks", () => {
  it("checks on launch and then on a recurring timer", () => {
    vi.useFakeTimers()
    const { manager } = createManager("win32", "notify")

    manager.start()
    expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled()

    // The launch check is delayed past first paint rather than fired inline.
    vi.advanceTimersByTime(5_000)
    expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledTimes(1)

    // A window left open long enough sees the next one. This is the whole
    // point: a launch-only check means the users who never quit the app are the
    // last to hear about a release.
    vi.advanceTimersByTime(6 * 60 * 60 * 1_000)
    expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(6 * 60 * 60 * 1_000)
    expect(vi.mocked(autoUpdater.checkForUpdates)).toHaveBeenCalledTimes(3)
  })

  it("shows no spinner for a check the user did not ask for", async () => {
    const { manager, pushed } = createManager("win32", "notify")

    await manager.backgroundCheck()

    // "checking" belongs to the Check for updates button. Painting it into a
    // panel nobody opened is noise, and it would blink the pending dot off.
    expect(pushed.map((status) => status.state)).not.toContain("checking")
  })

  it("shows no spinner for a background check on the notice-only path either", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" }))))
    const { manager, pushed } = createManager("darwin", "notify")

    await manager.backgroundCheck()

    // Same guarantee, different mechanism: this path patches the state itself
    // rather than reacting to an electron-updater event.
    expect(pushed.map((status) => status.state)).not.toContain("checking")
    expect(pushed.at(-1)?.state).toBe("available")
  })

  it("still shows the spinner for an explicit check", async () => {
    const { manager, pushed } = createManager("win32", "notify")

    await manager.check()

    expect(pushed.map((status) => status.state)).toContain("checking")
  })

  it("logs a failed background check instead of painting an error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED"))))
    const { manager } = createManager("darwin", "notify")

    const status = await manager.backgroundCheck()

    // Being briefly offline is not a problem report. The panel would otherwise
    // greet the user with a red error they never triggered and cannot act on.
    expect(status.state).toBe("idle")
    expect(status.error).toBeNull()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("net::ERR_NAME_NOT_RESOLVED"))
  })

  it("swallows a background failure on the auto-installing path too", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(new Error("net::ERR_INTERNET_DISCONNECTED"))
    const { manager } = createManager("win32", "notify")

    const status = await manager.backgroundCheck()

    expect(status.state).toBe("idle")
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("net::ERR_INTERNET_DISCONNECTED"))
  })

  it("still reports a failure the user asked for", async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(new Error("net::ERR_FAILED"))
    const { manager } = createManager("win32", "notify")

    const status = await manager.check()

    expect(status.state).toBe("error")
    expect(status.error).toBe("net::ERR_FAILED")
  })

  it("reports an update a background check finds", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" }))))
    const { manager } = createManager("darwin", "notify")

    const status = await manager.backgroundCheck()

    // Silent about failures, never about the thing it exists to find.
    expect(status).toMatchObject({ state: "available", latestVersion: "0.7.0" })
  })

  it("does not re-check while a download is in flight", async () => {
    const { manager } = createManager("win32", "automatic")
    emit("update-available", { version: "0.7.0" })
    vi.mocked(autoUpdater.checkForUpdates).mockClear()

    await manager.backgroundCheck()

    expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled()
  })

  it("does not re-check once an update is staged for restart", async () => {
    const { manager } = createManager("win32", "notify")
    emit("update-downloaded", { version: "0.7.0" })
    vi.mocked(autoUpdater.checkForUpdates).mockClear()

    await manager.backgroundCheck()

    // Already in the best available position; a check could only restate it.
    expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled()
    expect(manager.getStatus().state).toBe("downloaded")
  })
})

describe("UpdateManager dev update override", () => {
  const originalFlag = process.env["APIWEAVE_DEV_UPDATES"]

  afterEach(() => {
    if (originalFlag === undefined) delete process.env["APIWEAVE_DEV_UPDATES"]
    else process.env["APIWEAVE_DEV_UPDATES"] = originalFlag
    autoUpdater.forceDevUpdateConfig = false
  })

  it("leaves an ordinary dev run off the network", async () => {
    electronApp.isPackaged = false
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createManager("darwin", "notify")
    const status = await manager.check()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(autoUpdater.forceDevUpdateConfig).toBe(false)
    expect(status.state).toBe("not-available")
  })

  it("runs the real check in a dev build when the override is set", async () => {
    electronApp.isPackaged = false
    process.env["APIWEAVE_DEV_UPDATES"] = "1"
    const fetchSpy = vi.fn(() => Promise.resolve(manifestResponse({ schema: 1, version: "0.7.0" })))
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createManager("darwin", "notify")
    const status = await manager.check()

    // Without this the download-and-install path first executes on a user's
    // machine, which is the gap the override exists to close.
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(status).toMatchObject({ state: "available", latestVersion: "0.7.0" })
  })

  it("points electron-updater at dev-app-update.yml on the self-installing path", () => {
    electronApp.isPackaged = false
    process.env["APIWEAVE_DEV_UPDATES"] = "1"

    createManager("win32", "notify")

    // electron-updater's own isUpdaterActive() refuses an unpackaged run unless
    // this is set, so without it checkForUpdates resolves null and nothing runs.
    expect(autoUpdater.forceDevUpdateConfig).toBe(true)
  })

  it("ignores any value other than 1, so a stray export cannot arm it", async () => {
    electronApp.isPackaged = false
    process.env["APIWEAVE_DEV_UPDATES"] = "true"
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { manager } = createManager("darwin", "notify")
    await manager.check()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("UpdateManager teardown", () => {
  it("removes every listener it added to the shared singleton", () => {
    const { manager } = createManager("win32", "notify")
    expect(listenerCount()).toBeGreaterThan(0)

    manager.dispose()

    expect(listenerCount()).toBe(0)
  })

  it("stops the scheduler", () => {
    vi.useFakeTimers()
    const { manager } = createManager("win32", "notify")
    manager.start()

    manager.dispose()
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000)

    expect(vi.mocked(autoUpdater.checkForUpdates)).not.toHaveBeenCalled()
  })

  it("leaves a second manager's listeners alone", () => {
    const first = createManager("win32", "notify")
    const second = createManager("win32", "notify")
    const bothLive = listenerCount()

    first.manager.dispose()

    // The bug this guards: dispose() reaching for removeAllListeners would take
    // the surviving manager's handlers down with it, and its status would then
    // silently stop tracking anything.
    expect(listenerCount()).toBe(bothLive / 2)
    emit("update-available", { version: "0.7.0" })
    expect(second.manager.getStatus().latestVersion).toBe("0.7.0")
    expect(first.manager.getStatus().latestVersion).toBeNull()
  })

  it("is safe to call twice", () => {
    const { manager } = createManager("win32", "notify")
    manager.dispose()
    expect(() => manager.dispose()).not.toThrow()
  })
})
