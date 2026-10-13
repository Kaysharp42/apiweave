import type { z } from "zod"
import type { ScriptTestResultSchema } from "../zod-schemas/ScriptTestResultSchema"

export type ScriptTestResult = z.infer<typeof ScriptTestResultSchema>
