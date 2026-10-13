import { z } from "zod"
import { PostmanRequiredSecretSchema } from "./PostmanRequiredSecretSchema"

/** The project a Postman import created, and what the user still has to do. */
export const PostmanImportResultSchema = z
  .object({
    projectId: z.string(),
    workflowCount: z.number().int().nonnegative(),
    environmentCount: z.number().int().nonnegative(),
    requiredSecrets: z.array(PostmanRequiredSecretSchema),
    /** Required secrets not yet in the workspace. */
    missingSecrets: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict()
