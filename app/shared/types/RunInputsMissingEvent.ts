import type { RunInputsRefusal } from "./RunInputsRefusal"

/**
 * An agent's run — `runs_create`, `projects_run` or `browser_inspect` — was
 * refused because it would read values that are not set, announced on the
 * unkeyed `apiweave:run-inputs-missing` channel.
 *
 * The agent is told too, but only the user can add a secret, so the window
 * shows them what is missing and where it goes.
 */
export interface RunInputsMissingEvent {
  /** The MCP client's own name for itself — self-reported, shown as such. */
  readonly agent: string
  readonly refusal: RunInputsRefusal
}
