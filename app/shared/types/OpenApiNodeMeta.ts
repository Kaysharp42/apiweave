import type { z } from "zod"
import type { OpenApiNodeMetaSchema } from "../zod-schemas/OpenApiNodeMetaSchema"

export type OpenApiNodeMeta = z.infer<typeof OpenApiNodeMetaSchema>
