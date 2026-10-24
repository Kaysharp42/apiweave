import { useState } from "react";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { GitSignInDialog } from "./GitSignInDialog";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import type { GitSignInButtonsProps } from "../../types";

const defaultHost = (provider: GitProvider): string => GIT_PROVIDERS[provider].defaultHost;

/** Sign in to GitHub… and Sign in to GitLab…, each opening the sign-in dialog for its tool. */
export function GitSignInButtons({ onSignedIn, hostFor = defaultHost, disabled = false }: GitSignInButtonsProps) {
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(["github", "gitlab"] as const).map((provider) => (
          <Button key={provider} variant="ghost" size="sm" disabled={disabled} onClick={() => setSigningIn(provider)}>
            Sign in to {GIT_PROVIDERS[provider].name}…
          </Button>
        ))}
      </div>
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
