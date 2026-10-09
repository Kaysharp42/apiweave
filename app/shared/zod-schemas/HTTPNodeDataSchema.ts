import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { FileUploadSchema } from "./FileUploadSchema"
import { FormDataEntrySchema } from "./FormDataEntrySchema"
import { GraphqlBodySchema } from "./GraphqlBodySchema"
import { HttpMethodSchema } from "./HttpMethodSchema"
import { HttpRetryConfigSchema } from "./HttpRetryConfigSchema"
import { HttpScriptsConfigSchema } from "./HttpScriptsConfigSchema"
import { JsonValueSchema } from "./JsonValueSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"
import { OpenApiNodeMetaSchema } from "./OpenApiNodeMetaSchema"
import { UrlEncodedEntrySchema } from "./UrlEncodedEntrySchema"

/**
 * Every string field here is placeholder-interpolated before the request goes
 * out: `{{env.NAME}}` (selected environment), `{{variables.NAME}}` (workflow
 * variable, manual or extracted), `{{prev.response.body.x}}` (previous node's
 * result), `{{secrets.NAME}}` (local scope chain), and `{{uuid()}}`-style
 * dynamic functions. The `.describe()` calls carry that to MCP clients, which
 * see this shape as the JSON schema for `workflows_create`/`workflows_update`.
 */
/** "200", "2XX" or "default", as OpenAPI keys its responses. */
export const RESPONSE_SCHEMA_KEY = /^(?:[1-5](?:\d\d|XX)|default)$/

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
      .enum(["none", "json", "raw", "form-data", "x-www-form-urlencoded", "binary", "graphql"])
      .optional()
      .describe('How to encode the body and which Content-Type to send. "graphql" sends `graphql` instead of `body`.'),
    graphql: GraphqlBodySchema.optional().describe(
      'The GraphQL request when bodyType is "graphql": POSTed as application/json {query, variables, operationName}, or sent as query parameters when the method is GET. A response with an `errors` array still returns 200; assert `response.body.errors` notExists to fail on it.',
    ),
    timeout: z.number().int().positive().optional().describe("Request timeout in seconds."),
    followRedirects: z.boolean().optional(),
    sslVerify: z.boolean().optional(),
    useCookieJar: z
      .boolean()
      .optional()
      .describe("Send the cookies earlier responses in this run set, and keep the ones this response sets. Defaults to true; false sends only this node's own cookies."),
    continueOnFail: z.boolean().optional().describe("When true, a failed request lets the run continue down the outgoing edge instead of stopping the branch."),
    expectedStatus: z
      .union([z.number().int().min(100).max(599), z.array(z.number().int().min(100).max(599)).min(1)])
      .optional()
      .describe(
        "The status code(s) this request is expected to return. The node passes when the response matches and fails when it does not, including when it returns 2xx. Omit for the default, where any 2xx passes. Use this for negative tests: a request that is supposed to be rejected.",
      ),
    retry: HttpRetryConfigSchema.optional().describe(
      "Send the request again: poll until a condition holds (`until`), or ride out network errors and 5xx responses. Attempts are recorded on the node result; the node fails with \"Condition not met after N attempts\" when the condition never holds.",
    ),
    scripts: HttpScriptsConfigSchema.optional().describe(
      "JavaScript run in a sandbox before the request is sent (sign it, rewrite it) and after the response arrives (transform values into variables, custom checks with aw.test). Secrets are read only by literal name: aw.secrets.get(\"NAME\").",
    ),
    extractors: z
      .record(z.string(), z.string())
      .optional()
      .describe('Captures values from this response into workflow variables: a map of variable name to a response path, e.g. {"token": "response.body.access_token"}. Later nodes read the value as "{{variables.token}}". Paths start at the response object: response.body.*, response.headers.*, response.statusCode.'),
    responseSchemas: z
      .record(z.string().regex(RESPONSE_SCHEMA_KEY), JsonValueSchema)
      .optional()
      .describe(
        'JSON Schemas the response body must match, keyed by status code: "200", a range like "2XX", or "default". The most specific key for the actual status applies; a status with no key is not checked. A mismatch fails the node and lists where the body differs. Filled from the spec on OpenAPI import.',
      ),
    openapiMeta: OpenApiNodeMetaSchema.optional().describe("Set by OpenAPI import: which operation this request came from, used to flag drift when the spec is refreshed."),
    fileUploads: z.array(FileUploadSchema).optional(),
    auth: AuthConfigSchema.optional(),
    formDataEntries: z.array(FormDataEntrySchema).optional(),
    urlEncodedEntries: z.array(UrlEncodedEntrySchema).optional(),
  })
  .strict()