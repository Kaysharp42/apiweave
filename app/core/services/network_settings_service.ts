import type { NetworkSettings } from "@shared/types/NetworkSettings"
import type { NetworkSettingsState } from "@shared/types/NetworkSettingsState"
import { NetworkSettingsSchema, NetworkSettingsUpdateSchema } from "@shared/zod-schemas/NetworkSettingsSchema"
import type { AppSettingsRepository } from "../repositories"
import { decrypt, encrypt } from "../secrets/crypto"
import { ValidationError } from "../ipc/errors"
import { loadCaCertificates, loadClientCertificate, type NetworkConfig } from "../runner/network"

const SETTINGS_KEY = "network.settings"
const PROXY_PASSWORD_KEY = "network.proxyPassword"
const PASSPHRASE_PREFIX = "network.passphrase."

/** Trust the OS store out of the box: a corporate CA installed there then just works. */
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  proxyUrl: "",
  proxyBypass: "localhost,127.0.0.1,[::1]",
  proxyUsername: "",
  useSystemCa: true,
  caCertificateFiles: [],
  clientCertificates: [],
}

interface Credentials {
  readonly proxyPassword: string | undefined
  readonly passphrases: ReadonlyMap<string, string>
}

/**
 * Settings > Network: the proxy, trusted CAs and client certificates the
 * runner uses, stored in `app_settings`. Machine-wide, like the OS proxy
 * settings, so the proxy password and certificate passphrases are not
 * workspace secrets: each is sealed on its own (AES-GCM under the secrets
 * master key, bound to its row) and is never returned — the state says only
 * whether one is stored.
 *
 * Certificate files are referenced by path and read when the settings are
 * applied; nothing here is ever part of a workflow or an export.
 */
export class NetworkSettingsService {
  public constructor(
    private readonly settings: AppSettingsRepository,
    private readonly masterKek: Uint8Array,
  ) {}

  public state(): NetworkSettingsState {
    const settings = this.stored()
    const credentials = this.credentials(settings)
    let problem: string | null = null
    try {
      buildNetworkConfig(settings, credentials)
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error)
    }
    return {
      settings,
      proxyPasswordSet: credentials.proxyPassword !== undefined,
      passphraseSet: [...credentials.passphrases.keys()],
      problem,
    }
  }

  /** The stored settings, loaded. Throws when a file is missing or unusable. */
  public config(): NetworkConfig {
    const settings = this.stored()
    return buildNetworkConfig(settings, this.credentials(settings))
  }

  /**
   * Check the update can be applied — every file read, every key and
   * passphrase tried — and only then store it. Returns the loaded config.
   */
  public save(input: unknown): NetworkConfig {
    const update = NetworkSettingsUpdateSchema.parse(input)
    const { settings } = update
    const current = this.credentials(this.stored())
    const passphrases = new Map<string, string>()
    for (const { id } of settings.clientCertificates) {
      const given = update.passphrases?.[id]
      const value = given === undefined ? current.passphrases.get(id) : given
      if (value !== null && value !== undefined && value !== "") passphrases.set(id, value)
    }
    const givenPassword = update.proxyPassword
    const proxyPassword = givenPassword === undefined ? current.proxyPassword : givenPassword ?? undefined
    const credentials: Credentials = {
      // A password without a username is never sent; don't keep it.
      proxyPassword: settings.proxyUsername && proxyPassword ? proxyPassword : undefined,
      passphrases,
    }
    let config: NetworkConfig
    try {
      config = buildNetworkConfig(settings, credentials)
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error))
    }

    this.settings.set(SETTINGS_KEY, JSON.stringify(settings))
    this.writeSealed(PROXY_PASSWORD_KEY, credentials.proxyPassword)
    for (const id of current.passphrases.keys()) {
      if (!passphrases.has(id)) this.settings.delete(PASSPHRASE_PREFIX + id)
    }
    for (const [id, value] of passphrases) this.writeSealed(PASSPHRASE_PREFIX + id, value)
    return config
  }

  private stored(): NetworkSettings {
    const raw = this.settings.get(SETTINGS_KEY)
    if (raw === undefined) return DEFAULT_NETWORK_SETTINGS
    const parsed = NetworkSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_NETWORK_SETTINGS
  }

  private credentials(settings: NetworkSettings): Credentials {
    const passphrases = new Map<string, string>()
    for (const { id } of settings.clientCertificates) {
      const value = this.readSealed(PASSPHRASE_PREFIX + id)
      if (value !== undefined) passphrases.set(id, value)
    }
    return { proxyPassword: this.readSealed(PROXY_PASSWORD_KEY), passphrases }
  }

  private writeSealed(key: string, value: string | undefined): void {
    if (value === undefined) {
      this.settings.delete(key)
      return
    }
    const blob = encrypt(value, this.masterKek, "network", undefined, Buffer.from(key))
    this.settings.set(key, JSON.stringify({ nonce: Buffer.from(blob.nonce).toString("base64"), ciphertext: Buffer.from(blob.ciphertext).toString("base64") }))
  }

  private readSealed(key: string): string | undefined {
    const raw = this.settings.get(key)
    if (raw === undefined) return undefined
    const { nonce, ciphertext } = JSON.parse(raw) as { nonce: string; ciphertext: string }
    return decrypt(
      { nonce: Buffer.from(nonce, "base64"), ciphertext: Buffer.from(ciphertext, "base64"), kekId: "network", algorithm: "aes-256-gcm" },
      this.masterKek,
      Buffer.from(key),
    )
  }
}

function buildNetworkConfig(settings: NetworkSettings, credentials: Credentials): NetworkConfig {
  return {
    ...proxyConfig(settings, credentials.proxyPassword),
    ca: loadCaCertificates(settings.caCertificateFiles),
    useSystemCa: settings.useSystemCa,
    clientCertificates: settings.clientCertificates.map((entry) => {
      const passphrase = credentials.passphrases.get(entry.id)
      return loadClientCertificate({
        host: entry.host,
        ...(entry.pfxFile ? { pfxFile: entry.pfxFile } : {}),
        ...(entry.certFile ? { certFile: entry.certFile } : {}),
        ...(entry.keyFile ? { keyFile: entry.keyFile } : {}),
        ...(passphrase === undefined ? {} : { passphrase }),
      })
    }),
  }
}

function proxyConfig(settings: NetworkSettings, password: string | undefined): Pick<NetworkConfig, "proxy" | "noProxy"> {
  const text = settings.proxyUrl.trim()
  if (text === "") return {}
  let url: URL
  try {
    url = new URL(text.includes("://") ? text : `http://${text}`)
  } catch {
    throw new Error(`Proxy: ${text} is not a URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Proxy: use an http:// or https:// proxy URL")
  if (url.username || url.password) throw new Error("Proxy: put the username and password in their own fields, not in the URL")
  if (settings.proxyUsername) {
    url.username = encodeURIComponent(settings.proxyUsername)
    url.password = encodeURIComponent(password ?? "")
  }
  return { proxy: url.toString(), noProxy: settings.proxyBypass }
}
