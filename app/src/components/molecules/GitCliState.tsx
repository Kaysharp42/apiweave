import { GitCliInstallLink } from "./GitCliInstallLink";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import type { GitCliStateProps } from "../../types";

/** Whether a provider's command-line tool is installed and which version, or where to get it when it is not. */
export function GitCliState({ cli }: GitCliStateProps) {
  if (cli === undefined) return null;
  const tool = GIT_PROVIDERS[cli.provider];
  if (cli.missing) {
    return (
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
<<<<<<< HEAD
        <strong className="font-semibold text-status-warning">The {tool.cliName} is not installed.</strong> APIWeave
        signs in to {tool.name} with it. Install it from <GitCliInstallLink provider={cli.provider} />, then refresh.
        Until then, connect a remote by its URL, signed in with your own git credentials.
      </p>
    );
  }
  return (
    <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
      {tool.cliName} {cli.version ?? "(version unknown)"} is installed.
    </p>
  );
}
