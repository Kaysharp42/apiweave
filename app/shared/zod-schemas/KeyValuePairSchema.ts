import { z } from "zod"

/**
 * Canonical form for HTTP-request key/value fields (headers, cookies, query
 * params, path variables) on a persisted workflow node.
 *
 * Why an array of `{ key, value, active? }` and NOT a `Record<string,string>`
 * or a `string`:
 *   - It can express the "active=false / disabled entry" flag that
 *     `NodeModal`/`KeyValueEditor` already surface in the UI. A record drops
 *     order and the active bit; a multiline string drops order and per-entry
 *     enable state entirely.
 *   - Order is observable (UI re-ordering persists; `Record<...>`
 *     re-normalises keys nondeterministically), which matches the editor
 *     model and keeps diffs readable.
 *   - The runner maps a `KeyValuePair[]` to `Record<string,string>` in one
 *     obvious place (`executor.normalizeKeyValueField`) — that pass is the
 *     only translation step in the whole system, instead of every caller
 *     having to know whether the storage form is string / object / array.
 *
 * `key` and `value` are required strings (empty string is valid — it is the
 * UI's "incomplete row" state). `active` is optional, defaulting to active.
 */
export const KeyValuePairSchema = z
  .object({
    key: z
      .string()
      .describe('The entry\'s name, e.g. "Authorization". Empty is the editor\'s incomplete-row state and is skipped at run time.'),
    value: z
      .string()
      .describe('The entry\'s value. Placeholders are substituted at run time; reference credentials as "{{secrets.NAME}}" rather than inlining them.'),
    active: z.boolean().optional().describe("When false the entry is stored but not sent. Defaults to true."),
  })
  .strict()

export type KeyValuePair = z.infer<typeof KeyValuePairSchema>