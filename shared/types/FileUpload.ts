import type { z } from "zod"
import type { FileUploadSchema } from "../zod-schemas/FileUploadSchema"

export type FileUpload = z.infer<typeof FileUploadSchema>
