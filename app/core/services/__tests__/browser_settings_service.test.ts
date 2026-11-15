import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { AppSettingsRepository } from "../../repositories"
import { ValidationError } from "../../ipc/errors"
import { BrowserSettingsService, DEFAULT_BROWSER_SETTINGS } from "../browser_settings_service"

let database: InitializedDatabase
let settings: AppSettingsRepository
let service: BrowserSettingsService

beforeEach(() => {
  database = initDatabase({ databasePath: ":memory:" })
  settings = new AppSettingsRepository(database.kvStore)
  service = new BrowserSettingsService(settings)
})

afterEach(() => database.close())

describe("BrowserSettingsService", () => {
  it("starts from the default: the first browser that starts, headless", () => {
    expect(service.get()).toEqual(DEFAULT_BROWSER_SETTINGS)
    expect(DEFAULT_BROWSER_SETTINGS).toEqual({ showBrowser: false })
  })

  it("round-trips a chosen channel and the visible-run switch", () => {
    const saved = service.save({ channel: "msedge", showBrowser: true })
    expect(saved).toEqual({ channel: "msedge", showBrowser: true })
    expect(service.get()).toEqual({ channel: "msedge", showBrowser: true })
    // The choice is stored, not re-derived on read.
    expect(settings.get("browser.settings")).toContain("msedge")
  })

  it.each([
    ["not JSON at all", "showBrowser="],
    ["the wrong shape", JSON.stringify({ showBrowser: "yes" })],
    ["an unknown field", JSON.stringify({ showBrowser: false, headed: true })],
    ["a browser this app cannot drive", JSON.stringify({ channel: "firefox", showBrowser: false })],
  ])("falls back to the default when the stored row is unusable (%s)", (_label, raw) => {
    settings.set("browser.settings", raw)
    expect(service.get()).toEqual(DEFAULT_BROWSER_SETTINGS)
  })

  it("refuses an invalid save and stores nothing", () => {
    expect(() => service.save({ channel: "firefox", showBrowser: false })).toThrow(ValidationError)
    expect(() => service.save({ showBrowser: "yes" })).toThrow(ValidationError)
    expect(settings.get("browser.settings")).toBeUndefined()
  })
})
