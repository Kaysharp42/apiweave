import type { z } from "zod"
import type { PostmanRequiredSecretSchema } from "../zod-schemas/PostmanRequiredSecretSchema"

export type PostmanRequiredSecret = z.infer<typeof PostmanRequiredSecretSchema>
