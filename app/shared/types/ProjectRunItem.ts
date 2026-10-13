import type { z } from "zod"
import type { ProjectRunItemSchema } from "../zod-schemas/ProjectRunItemSchema"

export type ProjectRunItem = z.infer<typeof ProjectRunItemSchema>
