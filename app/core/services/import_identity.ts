import { stableId } from "../id"
import type { WorkflowRepository } from "../repositories"

/**
 * The id an imported workflow is created under, or undefined to mint a random
 * one. An import must give the same file the same identity every time, because
 * records keyed by workflow id (snapshot baselines, notably in the CLI, which
 * imports into a fresh database on every run) have to find their workflow
 * again. So: the file's declared id when no workflow holds it; with none
 * declared, an id derived from the name; when the id is taken, a genuine
 * second import, a random one rather than overwriting. Ids are global, so
 * "taken" looks across every workspace.
 */
export function importedWorkflowId(workflows: WorkflowRepository, declaredId: string | undefined, name: string): string | undefined {
  const candidate = declaredId !== undefined && declaredId !== "" ? declaredId : stableId(`workflow:${name}`)
  return workflows.getById(candidate) === undefined ? candidate : undefined
}
