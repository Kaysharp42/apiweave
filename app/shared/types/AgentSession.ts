import type { z } from "zod"
import type {
  AgentLaunchModeSchema,
  AgentSessionSchema,
  AgentSessionStatusSchema,
} from "../zod-schemas/AgentSessionSchema"

export type AgentSession = z.infer<typeof AgentSessionSchema>
export type AgentLaunchMode = z.infer<typeof AgentLaunchModeSchema>
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>
