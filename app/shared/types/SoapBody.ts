import type { z } from "zod"
import type { SoapBodySchema } from "../zod-schemas/SoapBodySchema"

export type SoapBody = z.infer<typeof SoapBodySchema>
