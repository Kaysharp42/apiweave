/**
 * The document title for the open tab, workspace and app — or just the app's
 * name when nothing is open.
 */
export function windowTitle(
  workflowName: string | null,
  workspaceName: string | null,
): string {
  if (workflowName === null) return "APIWeave";
  return workspaceName === null
    ? `${workflowName} — APIWeave`
    : `${workflowName} — ${workspaceName} — APIWeave`;
}
