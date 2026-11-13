import type { z } from "zod"
import type { JsonrpcBodySchema } from "../zod-schemas/JsonrpcBodySchema"

export type JsonrpcBody = z.infer<typeof JsonrpcBodySchema>
