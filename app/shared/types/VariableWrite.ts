/**
 * A workflow variable a node sets, and how: an extractor
 * (`field: "extractors"`, `path` its extractor path), a Call Workflow
 * `outputMapping` (`path` the child variable copied), a browser `extract` step
 * (`field: "variable"`, `path` such as `page.text`) or a script's
 * `aw.variables.set` (`field: "scripts"`, `path` such as `scripts.postResponse`).
 */
export interface VariableWrite {
  readonly name: string
  readonly field: "extractors" | "outputMapping" | "variable" | "scripts"
  readonly path: string
}
