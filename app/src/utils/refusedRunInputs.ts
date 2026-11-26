import { RunInputsRefusalSchema } from "@shared/zod-schemas/RunInputCheckSchema";
import type { RunInputCheck } from "@shared/types/RunInputCheck";
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal";
import { IpcError } from "./apiweaveClient";

/**
 * The refusal a run was stopped with, when `error` is one: main's
 * `MissingRunInputsError` puts it in `details.runInputs`. Null for any other
 * error, which the caller reports as it always has.
 */
export function refusedRunInputs(error: unknown): RunInputsRefusal | null {
  if (!(error instanceof IpcError) || error.code !== "validation") return null;
  const details = error.details;
  if (typeof details !== "object" || details === null || !("runInputs" in details)) return null;
  const parsed = RunInputsRefusalSchema.safeParse(details.runInputs);
  return parsed.success ? parsed.data : null;
}

/** A workflow's own check, as the refusal its run would get. */
export function workflowRefusal(check: RunInputCheck): RunInputsRefusal {
  return { target: { kind: "workflow", name: check.workflowName }, checks: [check] };
}
