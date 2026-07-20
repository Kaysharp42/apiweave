import type { z } from "zod"
import type { HttpMethodSchema } from "../zod-schemas/HttpMethodSchema"

export type HttpMethod = z.infer<typeof HttpMethodSchema>
