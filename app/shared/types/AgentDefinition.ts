import type { z } from "zod"
import type {
  AgentDefinitionSchema,
  AgentPromptModeSchema,
  StoredAgentDefinitionSchema,
} from "../zod-schemas/AgentDefinitionSchema"

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type StoredAgentDefinition = z.infer<typeof StoredAgentDefinitionSchema>
export type AgentPromptMode = z.infer<typeof AgentPromptModeSchema>
