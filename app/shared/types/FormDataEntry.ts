import type { z } from "zod"
import type { FormDataEntrySchema } from "../zod-schemas/FormDataEntrySchema"

export type FormDataEntry = z.infer<typeof FormDataEntrySchema>
