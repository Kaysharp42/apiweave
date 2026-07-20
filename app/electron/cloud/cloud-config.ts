import { z } from "zod"

export const CANONICAL_CLOUD_ENTRY_URL = "https://apiweave.kaysharp.com"
export const DESKTOP_CONFIG_PATH = "/api/desktop/config"
export const SUPPORTED_SYNC_PROTOCOL_VERSIONS = [1] as const

export interface DesktopCloudConfig {
  readonly version: 1
  readonly webBaseUrl: string
  readonly apiBaseUrl: string
  readonly oidcIssuer: string
  readonly desktopClientId: string
  readonly minimumDesktopVersion: string
  readonly syncProtocolVersions: readonly number[]
}

export type DesktopCloudConfigClient = (
  cloudEntryUrl: string,
  signal: AbortSignal,
) => Promise<DesktopCloudConfig>

export class ErrCloudConfigUnavailable extends Error {
  public constructor(status?: number) {
    super(status === undefined
      ? "Cloud configuration is unavailable"
      : `Cloud configuration is unavailable (HTTP ${status})`)
    this.name = "ErrCloudConfigUnavailable"
  }
}

export class ErrCloudConfigInvalid extends Error {
  public constructor() {
    super("Cloud configuration is invalid or unsupported")
    this.name = "ErrCloudConfigInvalid"
  }
}

const rawConfigSchema = z
  .object({
    version: z.literal(1),
    webBaseUrl: z.string().min(1),
    apiBaseUrl: z.string().min(1),
    oidcIssuer: z.string().min(1),
    desktopClientId: z.string().min(1).max(256).regex(/^\S+$/),
    minimumDesktopVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
    syncProtocolVersions: z.array(z.number().int().positive()).min(1),
  })
  .strict()

export const fetchDesktopCloudConfig: DesktopCloudConfigClient = async (cloudEntryUrl, signal) => {
  const entryUrl = normalizePublicBaseUrl(cloudEntryUrl)
  let response: Response
  try {
    response = await fetch(`${entryUrl}${DESKTOP_CONFIG_PATH}`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal,
    })
  } catch {
    if (signal.aborted) {
      throw signal.reason
    }
    throw new ErrCloudConfigUnavailable()
  }

  if (!response.ok) {
    throw new ErrCloudConfigUnavailable(response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ErrCloudConfigInvalid()
  }
  return parseDesktopCloudConfig(body, entryUrl)
}

export function parseDesktopCloudConfig(value: unknown, cloudEntryUrl: string): DesktopCloudConfig {
  try {
    const entryUrl = normalizePublicBaseUrl(cloudEntryUrl)
    const parsed = rawConfigSchema.parse(value)
    const config: DesktopCloudConfig = {
      version: parsed.version,
      webBaseUrl: normalizePublicBaseUrl(parsed.webBaseUrl),
      apiBaseUrl: normalizePublicBaseUrl(parsed.apiBaseUrl),
      oidcIssuer: normalizePublicBaseUrl(parsed.oidcIssuer),
      desktopClientId: parsed.desktopClientId,
      minimumDesktopVersion: parsed.minimumDesktopVersion,
      syncProtocolVersions: parsed.syncProtocolVersions,
    }
    if (
      config.webBaseUrl !== entryUrl
      || !SUPPORTED_SYNC_PROTOCOL_VERSIONS.some((version) => config.syncProtocolVersions.includes(version))
    ) {
      throw new ErrCloudConfigInvalid()
    }
    return config
  } catch (error) {
    if (error instanceof ErrCloudConfigInvalid) {
      throw error
    }
    throw new ErrCloudConfigInvalid()
  }
}

export function normalizePublicBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ErrCloudConfigInvalid()
  }
  if (
    url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname)))
  ) {
    throw new ErrCloudConfigInvalid()
  }
  return url.origin
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "::1"
    || normalized === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}
