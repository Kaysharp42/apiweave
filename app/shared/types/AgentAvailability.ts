import type { z } from "zod"
import type { AgentAvailabilitySchema, AgentAvailabilityStateSchema } from "../zod-schemas/AgentAvailabilitySchema"

export type AgentAvailability = z.infer<typeof AgentAvailabilitySchema>
export type AgentAvailabilityState = z.infer<typeof AgentAvailabilityStateSchema>
