import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { FileUploadSchema } from "./FileUploadSchema"
import { FormDataEntrySchema } from "./FormDataEntrySchema"
import { HttpMethodSchema } from "./HttpMethodSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"
import { UrlEncodedEntrySchema } from "./UrlEncodedEntrySchema"

/**
 * Every string field here is placeholder-interpolated before the request goes
 * out: `{{env.NAME}}` (selected environment), `{{variables.NAME}}` (workflow
 * variable, manual or extracted), `{{prev.response.body.x}}` (previous node's
 * result), `{{secrets.NAME}}` (local scope chain), and `{{uuid()}}`-style
 * dynamic functions. The `.describe()` calls carry that to MCP clients, which
 * see this shape as the JSON schema for `workflows_create`/`workflows_update`.
 */
export const HTTPNodeDataSchema = z
  .object({
    method: HttpMethodSchema.optional().describe("HTTP method. Defaults to GET when omitted."),
    url: z
      .string()
      .optional()
      .describe('Full request URL. Placeholders are substituted at run time, e.g. "{{env.BASE_URL}}/users/{{variables.userId}}".'),
    queryParams: z.array(KeyValuePairSchema).optional().describe("Query string parameters as {key, value} pairs. Values accept placeholders."),
    pathVariables: z.array(KeyValuePairSchema).optional().describe("Path parameter substitutions as {key, value} pairs."),
    headers: z
      .array(KeyValuePairSchema)
      .optional()
      .describe('Request headers as {key, value} pairs — NOT a map. Reference credentials as "{{secrets.NAME}}" rather than inlining them, e.g. {"key": "Authorization", "value": "Bearer {{secrets.API_TOKEN}}"}.'),
    cookies: z.array(KeyValuePairSchema).optional().describe("Request cookies as {key, value} pairs."),
    body: z
      .string()
      .optional()
      .describe('Request body as a STRING, not an object — JSON bodies are the serialized text, e.g. "{\\"name\\": \\"Rex\\"}". Placeholders are substituted inside it. Set bodyType to "json" alongside it.'),
    bodyType: z
      .enum(["none", "json", "raw", "form-data", "x-www-form-urlencoded", "binary"])
      .optional()
      .describe("How to encode the body and which Content-Type to send."),
    timeout: z.number().int().positive().optional().describe("Request timeout in seconds."),
    followRedirects: z.boolean().optional(),
    sslVerify: z.boolean().optional(),
    continueOnFail: z.boolean().optional().describe("When true, a failed request lets the run continue down the outgoing edge instead of stopping the branch."),
    extractors: z
      .record(z.string(), z.string())
      .optional()
      .describe('Captures values from this response into workflow variables: a map of variable name to a response path, e.g. {"token": "response.body.access_token"}. Later nodes read the value as "{{variables.token}}". Paths start at the response object: response.body.*, response.headers.*, response.statusCode.'),
    fileUploads: z.array(FileUploadSchema).optional(),
    auth: AuthConfigSchema.optional(),
    formDataEntries: z.array(FormDataEntrySchema).optional(),
    urlEncodedEntries: z.array(UrlEncodedEntrySchema).optional(),
  })
  .strict()