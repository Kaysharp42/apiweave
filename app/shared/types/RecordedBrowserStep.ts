import type { BrowserNodeData } from "./BrowserNodeData"

/**
 * One recorded step as the canvas receives it. The same `stepId` again
 * replaces that step's config: a fill is sent again as the user types. It is
 * also the canvas node id. Values are already templates (`{{env.*}}`,
 * `{{secrets.*}}`): no typed secret or password is ever in it.
 */
export interface RecordedBrowserStep {
  readonly stepId: string
  readonly config: BrowserNodeData
}
