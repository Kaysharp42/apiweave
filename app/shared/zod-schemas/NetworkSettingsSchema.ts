import { z } from "zod"

const path = z.string().max(4096)

/** A client certificate (mTLS) as Settings > Network stores it: files by path, the passphrase sealed apart by `id`. */
export const ClientCertificateSettingSchema = z
  .object({
    id: z.string().min(1).max(64),
    host: z.string().max(253),
    certFile: path,
    keyFile: path,
    pfxFile: path,
  })
  .strict()

/** Settings > Network, as stored in `app_settings` (`network.settings`). No credential is part of it. */
export const NetworkSettingsSchema = z
  .object({
    /** `http://proxy:8080`; "" for none. Credentials go in `proxyUsername` and the sealed password, never here. */
    proxyUrl: z.string().max(2048),
    /** NO_PROXY syntax: `localhost,.internal,10.0.0.1`. */
    proxyBypass: z.string().max(4096),
    proxyUsername: z.string().max(256),
    useSystemCa: z.boolean(),
    caCertificateFiles: z.array(path).max(20),
    clientCertificates: z.array(ClientCertificateSettingSchema).max(50),
  })
  .strict()

/**
 * A save from Settings > Network. A credential is written only when given:
 * a string replaces it, null removes it, absent keeps the stored one.
 */
export const NetworkSettingsUpdateSchema = z
  .object({
    settings: NetworkSettingsSchema,
    proxyPassword: z.string().max(1024).nullable().optional(),
    /** Client certificate passphrases, by certificate `id`. */
    passphrases: z.record(z.string(), z.string().max(1024).nullable()).optional(),
  })
  .strict()
