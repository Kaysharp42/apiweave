import type { z } from "zod"
import type { StreamFinishConditionSchema } from "../zod-schemas/StreamFinishConditionSchema"

export type StreamFinishCondition = z.infer<typeof StreamFinishConditionSchema>
