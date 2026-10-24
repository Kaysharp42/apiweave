import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import type { GitCliInstallLinkProps } from "../../types";

/** Where a provider's command-line tool is installed from, in the user's browser. */
export function GitCliInstallLink({ provider }: GitCliInstallLinkProps) {
  const tool = GIT_PROVIDERS[provider];
  return (
    <a
      href={tool.installUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 dark:text-primary-light"
    >
      {tool.installUrl.replace(/^https:\/\//, "")}
    </a>
  );
}
