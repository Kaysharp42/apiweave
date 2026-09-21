import { useContext, useEffect, useMemo, useState } from "react";
import { DYNAMIC_FUNCTIONS } from "@shared/constants/dynamicFunctions";
import WorkflowContext from "../contexts/WorkflowContext";
import WorkspaceContext from "../contexts/WorkspaceContext";
import useEnvironmentStore, {
  getSelectedEnvironment,
} from "../stores/EnvironmentStore";
import { resolveInheritedVariables } from "../utils/environmentInheritance";
import { previewValue } from "../utils/previewValue";
import { listScopedSecrets } from "./useSecretValues";
import type { TemplateSuggestion } from "../types/TemplateSuggestion";

/**
 * Everything `{{…}}` can name here, as one list: workflow variables, the
 * active environment's variables, the secret names reachable from it, the
 * dynamic functions, and the handful of upstream-response paths.
 *
 * It is deliberately scoped to the *active* environment. Offering a name from
 * an environment the run will not use is worse than offering nothing: the
 * reference survives substitution as literal `{{env.WHATEVER}}` text and goes
 * out on the wire, which usually surfaces as a 401 that looks like bad
 * credentials.
 */

/** How much of a variable's value the list shows beside its name. */
const DETAIL_LIMIT = 40;

/**
 * The response paths worth offering blind — the ones that exist on every HTTP
 * result whatever the endpoint returned. Field names inside the body depend on
 * a response nobody has seen yet, so they are not guessed at here.
 *
 * Note there is no `prev.response.cookies.*`: the executor's result object has
 * no cookies on it, and only an assertion (`source: "cookies"`) can read one.
 */
const RESPONSE_SUGGESTIONS: readonly TemplateSuggestion[] = [
  {
    insert: "prev.response.body",
    kind: "response",
    detail: "upstream response body — append .field",
  },
  {
    insert: "prev.response.headers.content-type",
    kind: "response",
    detail: "one response header, by name",
  },
  { insert: "prev.response.statusCode", kind: "response", detail: "200, 404…" },
  { insert: "prev.duration", kind: "response", detail: "elapsed milliseconds" },
];

const FUNCTION_SUGGESTIONS: readonly TemplateSuggestion[] =
  DYNAMIC_FUNCTIONS.map(({ signature, description }) => {
    const name = signature.slice(0, signature.indexOf("("));
    return {
      insert: `${name}()`,
      kind: "function" as const,
      detail: description,
      // A function that takes arguments wants the caret between its parens;
      // one that does not is finished the moment it is accepted.
      ...(signature.endsWith("()") ? {} : { caretOffset: name.length + 1 }),
    };
  });

/**
 * ponytail: module cache, one request per workspace+environment pair for the
 * life of the window. A secret added in another tab shows up after a reload.
 * Move it into a store if that becomes the complaint.
 */
const secretNamesByScope = new Map<string, Promise<readonly string[]>>();

function fetchSecretNames(
  workspaceId: string,
  environmentId: string | null,
): Promise<readonly string[]> {
  const key = `${workspaceId}::${environmentId ?? ""}`;
  const cached = secretNamesByScope.get(key);
  if (cached) return cached;

  const pending = Promise.all([
    listScopedSecrets("workspace", workspaceId, workspaceId),
    environmentId
      ? listScopedSecrets("environment", environmentId, workspaceId)
      : Promise.resolve([]),
  ])
    .then(([workspaceSecrets, environmentSecrets]) =>
      [
        ...new Set(
          [...workspaceSecrets, ...environmentSecrets].map(
            (secret) => secret.name,
          ),
        ),
      ].sort(),
    )
    .catch(() => {
      // Don't cache a failure: the next field to open its list retries.
      secretNamesByScope.delete(key);
      return [];
    });

  secretNamesByScope.set(key, pending);
  return pending;
}

/**
 * The two contexts are read through `useContext` rather than their `useX`
 * hooks so a field carrying this can be rendered anywhere — a shared control
 * like `KeyValueEditor` appears both inside a workflow and in isolation, and
 * an autocomplete is worth nothing if it throws where there is nothing to
 * complete. Outside a workflow the list is just the functions.
 */
export function useTemplateSuggestions(): readonly TemplateSuggestion[] {
  const workflow = useContext(WorkflowContext);
  const workspace = useContext(WorkspaceContext);
  const workflowId = workflow?.workflowId;
  const variables = workflow?.variables;
  // fallow-ignore-next-line code-duplication
  const workspaceId = workspace?.currentWorkspace?.workspaceId ?? null;
  const environments = useEnvironmentStore((state) => state.environments);
  const selectedEnvMap = useEnvironmentStore(
    (state) => state.selectedEnvironmentByWorkflow,
  );
  const [secretNames, setSecretNames] = useState<readonly string[]>([]);

  const environmentId = useMemo(
    () => (workflowId ? getSelectedEnvironment(workflowId) : null),
    // The resolver reads the store imperatively; this is what re-runs it.
    [workflowId, selectedEnvMap],
  );

  useEffect(() => {
    if (!workspaceId) return undefined;
    let active = true;
    void fetchSecretNames(workspaceId, environmentId).then((names) => {
      if (active) setSecretNames(names);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, environmentId]);

  return useMemo(() => {
    const environment = environments.find(
      (candidate) => candidate.environmentId === environmentId,
    );

    // Base first, the environment's own last — the same order the backend
    // merges them in, so the preview beside a name is the value that will win.
    const environmentVariables: Record<string, string> = {};
    for (const layer of resolveInheritedVariables(
      environment?.baseEnvironmentId,
      environments,
    )) {
      Object.assign(environmentVariables, layer.variables);
    }
    Object.assign(environmentVariables, environment?.variables ?? {});

    return [
      ...Object.entries(variables ?? {}).map(([name, value]) => ({
        insert: `variables.${name}`,
        kind: "variable" as const,
        detail: previewValue(value, DETAIL_LIMIT),
      })),
      ...Object.entries(environmentVariables).map(([name, value]) => ({
        insert: `env.${name}`,
        kind: "env" as const,
        detail: previewValue(value, DETAIL_LIMIT),
      })),
      // Names only. A secret's value is not in the renderer and must not be.
      ...secretNames.map((name) => ({
        insert: `secrets.${name}`,
        kind: "secret" as const,
      })),
      ...RESPONSE_SUGGESTIONS,
      ...FUNCTION_SUGGESTIONS,
    ];
  }, [variables, environments, environmentId, secretNames]);
}
