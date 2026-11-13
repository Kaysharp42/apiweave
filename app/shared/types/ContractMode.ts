import type { z } from "zod"
import type { ContractModeSchema } from "../zod-schemas/ContractModeSchema"

export type ContractMode = z.infer<typeof ContractModeSchema>
