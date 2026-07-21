import type { z } from "zod"
import type { RevisionSchema } from "../zod-schemas/RevisionSchema"

export type Revision = z.infer<typeof RevisionSchema>
