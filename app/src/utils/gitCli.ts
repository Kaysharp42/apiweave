import type { GitHostCli } from "@shared/types/GitHostCli";

/** A tool that is not installed, as last listed: its sign-ins cannot run until it is. */
export function cliMissing(clis: readonly GitHostCli[] | undefined, command: "gh" | "glab"): boolean {
  return clis?.find((cli) => cli.command === command)?.missing === true;
}

/** Whether both tools are listed and neither is installed: no sign-in is possible at all. */
export function bothClisMissing(clis: readonly GitHostCli[] | undefined): boolean {
  return cliMissing(clis, "gh") && cliMissing(clis, "glab");
}
