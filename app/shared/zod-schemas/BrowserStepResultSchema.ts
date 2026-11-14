import { z } from "zod"

/**
 * What a `browser` node did, stored on its run result. Every string here is
 * page content or a value the step compared, so the run's secret masker
 * scrubs it like a response body before it is stored; the node's `error` is
 * kept to the runner's own value-free message.
 */
export const BrowserStepResultSchema = z
  .object({
    action: z.string().min(1),
    /** The page URL after the step, without its query string. */
    url: z.string().optional(),
    /** The page title after the step. */
    title: z.string().optional(),
    /** `expect-*`: what the step waited for. */
    expected: z.string().optional(),
    /** `expect-*`: what the page showed last. `extract`: the value read. */
    actual: z.string().optional(),
    /** On failure: Playwright's own account of the failure, capped. */
    detail: z.string().optional(),
    /** On failure: the page's ARIA (accessibility) snapshot, capped. */
    ariaSnapshot: z.string().optional(),
    /** On failure: the screenshot's id in run artifacts, read with `runs.getArtifact`. */
    screenshotArtifactId: z.string().min(1).optional(),
    /** On failure: why evidence is missing or incomplete. */
    evidenceNote: z.string().optional(),
  })
  .strict()
