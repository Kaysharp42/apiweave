import type { z } from "zod"
import type { ClientCertificateSettingSchema } from "../zod-schemas/NetworkSettingsSchema"

export type ClientCertificateSetting = z.infer<typeof ClientCertificateSettingSchema>
