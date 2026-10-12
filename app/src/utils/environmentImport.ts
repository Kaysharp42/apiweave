import type { EnvImportPlan, EnvImportRow, EnvImportStatus } from "../types";

/**
 * What importing `row` would do to the environment as it stands. A key lives
 * in one namespace: a row that lands as a secret replaces a plain variable of
 * the same name, and a plain row replaces a secret, so both are conflicts.
 */
export function envImportStatus(
  row: EnvImportRow,
  variables: Readonly<Record<string, string>>,
  secretNames: ReadonlySet<string>,
): EnvImportStatus {
  if (secretNames.has(row.key)) return "exists";
  if (!Object.prototype.hasOwnProperty.call(variables, row.key)) return "new";
  if (row.asSecret) return "changed";
  return variables[row.key] === row.value ? "unchanged" : "changed";
}

/**
 * Split an import into plain variables and secrets. A row marked secret only
 * ever lands in `secrets`, so its value is never written as a plain variable,
 * and it removes a plain variable of the same name; a plain row removes a
 * secret of the same name. Otherwise `{{env.NAME}}` or `{{secrets.NAME}}`
 * would keep resolving to the old value. Conflicts (`changed`, `exists`) are
 * written only when `overwrite` is set.
 */
export function planEnvImport(
  rows: readonly EnvImportRow[],
  variables: Readonly<Record<string, string>>,
  secretNames: ReadonlySet<string>,
  overwrite: boolean,
): EnvImportPlan {
  const updates: [string, string][] = [];
  const plan: EnvImportPlan = {
    variables: {},
    secrets: [],
    removedVariables: [],
    removedSecrets: [],
    kept: 0,
  };
  for (const row of rows) {
    const status = envImportStatus(row, variables, secretNames);
    if (status === "unchanged") continue;
    if ((status === "changed" || status === "exists") && !overwrite) {
      plan.kept += 1;
      continue;
    }
    if (row.asSecret) {
      plan.secrets.push({ name: row.key, value: row.value });
      if (Object.prototype.hasOwnProperty.call(variables, row.key)) {
        plan.removedVariables.push(row.key);
      }
    } else {
      updates.push([row.key, row.value]);
      if (secretNames.has(row.key)) plan.removedSecrets.push(row.key);
    }
  }
  // fromEntries, not assignment: a key named `__proto__` stays an ordinary key.
  plan.variables = Object.fromEntries([
    ...Object.entries(variables).filter(([key]) => !plan.removedVariables.includes(key)),
    ...updates,
  ]);
  return plan;
}
