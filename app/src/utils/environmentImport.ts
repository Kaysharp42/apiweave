import type { EnvImportPlan, EnvImportRow, EnvImportStatus } from "../types";

/** What importing `row` would do to the environment as it stands. */
export function envImportStatus(
  row: EnvImportRow,
  variables: Readonly<Record<string, string>>,
  secretNames: ReadonlySet<string>,
): EnvImportStatus {
  if (row.asSecret) return secretNames.has(row.key) ? "exists" : "new";
  if (!Object.prototype.hasOwnProperty.call(variables, row.key)) return "new";
  return variables[row.key] === row.value ? "unchanged" : "changed";
}

/**
 * Split an import into plain variables and secrets. A row marked secret only
 * ever lands in `secrets`, so its value is never written as a plain variable.
 * Conflicts (`changed`, `exists`) are written only when `overwrite` is set.
 */
export function planEnvImport(
  rows: readonly EnvImportRow[],
  variables: Readonly<Record<string, string>>,
  secretNames: ReadonlySet<string>,
  overwrite: boolean,
): EnvImportPlan {
  const updates: [string, string][] = [];
  const plan: EnvImportPlan = { variables: {}, secrets: [], kept: 0 };
  for (const row of rows) {
    const status = envImportStatus(row, variables, secretNames);
    if (status === "unchanged") continue;
    if ((status === "changed" || status === "exists") && !overwrite) {
      plan.kept += 1;
      continue;
    }
    if (row.asSecret) plan.secrets.push({ name: row.key, value: row.value });
    else updates.push([row.key, row.value]);
  }
  // fromEntries, not assignment: a key named `__proto__` stays an ordinary key.
  plan.variables = Object.fromEntries([...Object.entries(variables), ...updates]);
  return plan;
}
