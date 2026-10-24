import { useState } from "react";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { GitCliInstallLink } from "../molecules/GitCliInstallLink";
import { GitSignInDialog } from "./GitSignInDialog";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import { bothClisMissing, cliMissing } from "../../utils/gitCli";
import type { GitSignInButtonsProps } from "../../types";

const defaultHost = (provider: GitProvider): string => GIT_PROVIDERS[provider].defaultHost;

/**
 * Sign in to GitHub… and Sign in to GitLab…, each opening the sign-in
 * dialog for its tool. A tool that is not installed offers no sign-in, and
 * when neither is, where to install them is said here.
 */
export function GitSignInButtons({ onSignedIn, clis, hostFor = defaultHost, disabled = false }: GitSignInButtonsProps) {
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
  const noneInstalled = bothClisMissing(clis);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(["github", "gitlab"] as const).map((provider) => (
          <Button
            key={provider}
            variant="ghost"
            size="sm"
            disabled={disabled || cliMissing(clis, GIT_PROVIDERS[provider].command)}
            onClick={() => setSigningIn(provider)}
          >
            Sign in to {GIT_PROVIDERS[provider].name}…
          </Button>
        ))}
      </div>
      {noneInstalled && (
        <p className="text-xs text-text-muted dark:text-text-muted-dark">
          Signing in needs the GitHub CLI (gh) and the GitLab CLI (glab): install them from{" "}
          <GitCliInstallLink provider="github" /> and <GitCliInstallLink provider="gitlab" />, then refresh.
        </p>
      )}
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={hostFor(signingIn)}
          onClose={() => setSigningIn(null)}
          onSignedIn={onSignedIn}
        />
      )}
    </>
  );
}
