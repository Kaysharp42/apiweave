import type { z } from "zod"
import type { ImportDryRunResultSchema } from "../zod-schemas/ImportDryRunResultSchema"

export type ImportDryRunResult = z.infer<typeof ImportDryRunResultSchema>
