import type { z } from "zod"
import type { MergeConditionSchema } from "../zod-schemas/MergeConditionSchema"

export type MergeCondition = z.infer<typeof MergeConditionSchema>
