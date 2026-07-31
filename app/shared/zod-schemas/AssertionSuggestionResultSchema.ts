import { z } from "zod"
import { AssertionItemSchema } from "./AssertionItemSchema"

const AssertionSuggestionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    confidence: z.enum(["high", "medium", "low"]),
    rationale: z.string().min(1),
    overfitRisk: z.enum(["low", "medium", "high"]),
    rules: z.array(AssertionItemSchema).min(1),
  })
  .strict()

export const AssertionSuggestionResultSchema = z
  .object({
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    sourceNodeId: z.string().min(1),
    suggestions: z.array(AssertionSuggestionSchema),
  })
  .strict()
