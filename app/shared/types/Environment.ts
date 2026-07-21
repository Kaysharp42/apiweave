import type { z } from "zod"
import type { EnvironmentSchema } from "../zod-schemas/EnvironmentSchema"

export type Environment = z.infer<typeof EnvironmentSchema>
