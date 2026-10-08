import { z } from "zod"
import { PostmanRequiredSecretSchema } from "./PostmanRequiredSecretSchema"

/** What importing a Postman collection would create, computed without writing anything. */
export const PostmanImportPreviewSchema = z
  .object({
    projectName: z.string(),
    workflows: z.array(z.object({ name: z.string(), requestCount: z.number().int().nonnegative() }).strict()),
    environment: z.object({ name: z.string(), variableCount: z.number().int().nonnegative() }).strict().nullable(),
    requiredSecrets: z.array(PostmanRequiredSecretSchema),
    warnings: z.array(z.string()),
  })
  .strict()
