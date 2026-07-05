import { z } from "zod"
import { FileUploadSchema } from "./FileUploadSchema"
import { HttpMethodSchema } from "./HttpMethodSchema"
import { JsonValueSchema } from "./JsonValueSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const HTTPNodeDataSchema = z
  .object({
    label: z.string().optional(),
    executionStatus: RunnerNodeStatusSchema.optional(),
    executionResult: z
      .object({
        body: JsonValueSchema.optional(),
        statusCode: z.number().int().optional(),
        duration: z.number().int().nonnegative().optional(),
        responseTimeMs: z.number().int().nonnegative().optional(),
        responseSizeBytes: z.number().int().nonnegative().optional(),
        contentType: z.string().optional(),
        bodyFormat: z.string().optional(),
        cookies: z.record(z.string(), z.string()).optional(),
        error: z.string().optional(),
      })
      .strict()
      .optional(),
    config: z
      .object({
        method: HttpMethodSchema.optional(),
        url: z.string().optional(),
        queryParams: z.string().optional(),
        pathVariables: z.string().optional(),
        headers: z.string().optional(),
        cookies: z.string().optional(),
        body: z.string().optional(),
        bodyType: z.enum(["json", "form-data", "raw", "none"]).optional(),
        timeout: z.number().int().positive().optional(),
        followRedirects: z.boolean().optional(),
        extractors: z.record(z.string(), z.string()).optional(),
        fileUploads: z.array(FileUploadSchema).optional(),
      })
      .strict()
      .optional(),
    branchCount: z.number().int().nonnegative().optional(),
  })
  .strict()
