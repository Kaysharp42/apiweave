import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { AssertionOperatorSchema } from "./AssertionOperatorSchema"
import { AssertionSourceSchema } from "./AssertionSourceSchema"

/**
 * Assertion config as produced by BOTH renderer editors (the inline
 * `AssertionNode` form and the `AssertionConfigPanel` modal) and consumed by
 * the executor: `source` + `path` locate the value, `operator` compares it
 * against `expectedValue`. The operator enum is kept in sync with the UI
 * operator list and the executor's `compareValues`; drift there is what let
 * assertion nodes save-fail at the persistence boundary.
 */
export const AssertionItemSchema = z
  .object({
    source: AssertionSourceSchema.describe(
      'Where the compared value comes from. "prev" = the upstream HTTP node\'s response object; "status" = its status code; "headers"/"cookies" = one named response header/cookie; "variables" = one workflow variable.',
    ),
    path: z
      .string()
      .describe(
        'Locates the value inside `source`, and its shape depends on `source`. "prev": a path into the response object — "response.body.<field>" (dot notation, [0] for array indexes, e.g. response.body.data[0].id), "response.headers.<name>", "response.statusCode" or "response.duration"; a bare field name like "id" is NOT valid. "status": must be the empty string. "headers"/"cookies"/"variables": just the name (e.g. "content-type", "session", "token"), with no response. prefix.',
      ),
    operator: AssertionOperatorSchema.describe(
      'How to compare. "exists"/"notExists" take no expectedValue; every other operator requires one. "count" requires a non-negative integer and compares the length of an array or string. "status" source accepts only equals, notEquals, gt, gte, lt or lte.',
    ),
    expectedValue: JsonValueSchema.optional().describe(
      'The value to compare against. Required except for "exists"/"notExists". Never inline a real credential here — a secret-looking literal is rejected; use a "{{secrets.NAME}}" reference instead.',
    ),
  })
  .strict()
