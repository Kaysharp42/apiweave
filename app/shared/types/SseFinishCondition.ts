import type { z } from "zod"
import type { SseFinishConditionSchema } from "../zod-schemas/SseFinishConditionSchema"

export type SseFinishCondition = z.infer<typeof SseFinishConditionSchema>
