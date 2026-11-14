import type { z } from "zod"
import type { RunArtifactSchema } from "../zod-schemas/RunArtifactSchema"

export type RunArtifact = z.infer<typeof RunArtifactSchema>
