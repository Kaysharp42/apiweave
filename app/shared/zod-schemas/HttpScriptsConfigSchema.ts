import { z } from "zod"

/** Longest script source accepted, in characters. */
export const MAX_SCRIPT_LENGTH = 100_000
/** Default and ceiling for a script's run time, in milliseconds. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 1000
export const MAX_SCRIPT_TIMEOUT_MS = 30_000

/**
 * JavaScript an http-request node runs in a sandbox (QuickJS compiled to
 * WebAssembly: no network, no file system, no timers, no host objects) just
 * before its request is sent and just after its response arrives. Scripts are
 * synchronous. The sandbox's API is the global `aw`; see docs/features/scripting.md.
 */
export const HttpScriptsConfigSchema = z
  .object({
    preRequest: z
      .string()
      .max(MAX_SCRIPT_LENGTH)
      .optional()
      .describe(
        "Runs after placeholders are resolved and before the request is sent. `aw.request` ({method, url, headers, body}) is mutable, e.g. `aw.request.headers[\"X-Signature\"] = aw.crypto.hmacSha256(aw.secrets.get(\"SIGNING_KEY\"), aw.request.body)`.",
      ),
    postResponse: z
      .string()
      .max(MAX_SCRIPT_LENGTH)
      .optional()
      .describe(
        "Runs once the response arrives (after retries). Reads `aw.response` (status, headers, body, json(), text()), sets variables with `aw.variables.set`, and checks it with `aw.test(name, fn)` / `aw.expect(value)`; a failed test fails the node.",
      ),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_SCRIPT_TIMEOUT_MS)
      .optional()
      .describe("Per-script time limit in milliseconds. Defaults to 1000."),
  })
  .strict()
