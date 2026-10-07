import type { z } from "zod"
import type { ProjectRunSchema } from "../zod-schemas/ProjectRunSchema"

export type ProjectRun = z.infer<typeof ProjectRunSchema>
