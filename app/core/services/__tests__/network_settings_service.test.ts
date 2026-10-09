import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { AppSettingsRepository } from "../../repositories"
import { ValidationError } from "../../ipc/errors"
import { DEFAULT_NETWORK_SETTINGS, NetworkSettingsService } from "../network_settings_service"
import { PFX_PASSPHRASE, fixturePath } from "../../runner/__tests__/network_test_servers"
import type { NetworkSettings } from "@shared/types/NetworkSettings"

let database: InitializedDatabase
let settings: AppSettingsRepository
let service: NetworkSettingsService

beforeEach(() => {
  database = initDatabase({ databasePath: ":memory:" })
  settings = new AppSettingsRepository(database.kvStore)
  service = new NetworkSettingsService(settings, randomBytes(32))
})

afterEach(() => database.close())

const pfxEntry = { id: "cert-1", host: "api.example.com", certFile: "", keyFile: "", pfxFile: fixturePath("client.pfx") }
const withProxy: NetworkSettings = { ...DEFAULT_NETWORK_SETTINGS, proxyUrl: "http://proxy.corp:3128", proxyUsername: "alice" }

describe("NetworkSettingsService", () => {
  it("starts from the defaults: no proxy, OS store trusted, nothing to load", () => {
    expect(service.state()).toEqual({ settings: DEFAULT_NETWORK_SETTINGS, proxyPasswordSet: false, passphraseSet: [], problem: null })
    expect(service.config()).toMatchObject({ useSystemCa: true, ca: [], clientCertificates: [] })
  })

  it("seals the proxy password and passphrases, reports only that they are stored, and loads them into the config", () => {
    const config = service.save({
      settings: { ...withProxy, caCertificateFiles: [fixturePath("ca.pem")], clientCertificates: [pfxEntry] },
      proxyPassword: "hunter2",
      passphrases: { "cert-1": PFX_PASSPHRASE },
    })
    expect(config.proxy).toBe("http://alice:hunter2@proxy.corp:3128/")
    expect(config.noProxy).toBe(DEFAULT_NETWORK_SETTINGS.proxyBypass)
    expect(config.ca).toHaveLength(1)
    expect(config.clientCertificates?.[0]).toMatchObject({ host: "api.example.com", passphrase: PFX_PASSPHRASE })

    const state = service.state()
    expect(state).toMatchObject({ proxyPasswordSet: true, passphraseSet: ["cert-1"], problem: null })
    expect(JSON.stringify(state)).not.toContain("hunter2")
    expect(JSON.stringify(state)).not.toContain(PFX_PASSPHRASE)
    expect(settings.get("network.proxyPassword")).not.toContain("hunter2")
    expect(settings.get("network.settings")).not.toContain("hunter2")
    // A sealed value is bound to its row: copied onto another, it does not open.
    settings.set("network.passphrase.cert-1", settings.get("network.proxyPassword")!)
    expect(() => service.config()).toThrow()
  })

  it("keeps a stored credential when a save leaves it out, and removes it on null", () => {
    service.save({ settings: withProxy, proxyPassword: "hunter2" })
    service.save({ settings: { ...withProxy, proxyBypass: "localhost" } })
    expect(service.config().proxy).toBe("http://alice:hunter2@proxy.corp:3128/")
    service.save({ settings: withProxy, proxyPassword: null })
    expect(service.state().proxyPasswordSet).toBe(false)
  })

  it("drops the password with the username, and a passphrase with its certificate", () => {
    service.save({ settings: { ...withProxy, clientCertificates: [pfxEntry] }, proxyPassword: "hunter2", passphrases: { "cert-1": PFX_PASSPHRASE } })
    service.save({ settings: { ...withProxy, proxyUsername: "" } })
    expect(service.state()).toMatchObject({ proxyPasswordSet: false, passphraseSet: [] })
    expect(settings.get("network.passphrase.cert-1")).toBeUndefined()
  })

  it.each([
    [{ ...DEFAULT_NETWORK_SETTINGS, caCertificateFiles: [fixturePath("nope.pem")] }, /cannot read/],
    [{ ...DEFAULT_NETWORK_SETTINGS, clientCertificates: [pfxEntry] }, /Client certificate for api\.example\.com/],
    [{ ...DEFAULT_NETWORK_SETTINGS, proxyUrl: "socks5://proxy:1080" }, /http:\/\/ or https:\/\//],
    [{ ...DEFAULT_NETWORK_SETTINGS, proxyUrl: "http://bob:pw@proxy:8080" }, /own fields/],
  ])("refuses settings that cannot be applied and stores nothing (%#)", (bad, message) => {
    expect(() => service.save({ settings: bad })).toThrow(ValidationError)
    expect(() => service.save({ settings: bad })).toThrow(message)
    expect(settings.get("network.settings")).toBeUndefined()
  })

  it("reports a stored file that no longer loads as the state's problem", () => {
    service.save({ settings: { ...DEFAULT_NETWORK_SETTINGS, caCertificateFiles: [fixturePath("ca.pem")] } })
    settings.set("network.settings", JSON.stringify({ ...DEFAULT_NETWORK_SETTINGS, caCertificateFiles: [fixturePath("moved.pem")] }))
    expect(service.state().problem).toMatch(/moved\.pem/)
    expect(() => service.config()).toThrow(/moved\.pem/)
  })
})
