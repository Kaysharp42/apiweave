import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { FileUploadSchema } from "./FileUploadSchema"
import { FormDataEntrySchema } from "./FormDataEntrySchema"
import { HttpMethodSchema } from "./HttpMethodSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"
import { UrlEncodedEntrySchema } from "./UrlEncodedEntrySchema"

export const HTTPNodeDataSchema = z
  .object({
    method: HttpMethodSchema.optional(),
    url: z.string().optional(),
    queryParams: z.array(KeyValuePairSchema).optional(),
    pathVariables: z.array(KeyValuePairSchema).optional(),
    headers: z.array(KeyValuePairSchema).optional(),
    cookies: z.array(KeyValuePairSchema).optional(),
    body: z.string().optional(),
    bodyType: z
      .enum(["none", "json", "raw", "form-data", "x-www-form-urlencoded", "binary"])
      .optional(),
    timeout: z.number().int().positive().optional(),
    followRedirects: z.boolean().optional(),
    sslVerify: z.boolean().optional(),
    continueOnFail: z.boolean().optional(),
    extractors: z.record(z.string(), z.string()).optional(),
    fileUploads: z.array(FileUploadSchema).optional(),
    auth: AuthConfigSchema.optional(),
    formDataEntries: z.array(FormDataEntrySchema).optional(),
    urlEncodedEntries: z.array(UrlEncodedEntrySchema).optional(),
  })
  .strict()