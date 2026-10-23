import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { git } from "../../utils/apiweaveClient";
import type { GitSignInDialogProps } from "../../types";

/** Where a sign-in is: about to start, waiting for the tool's code, waiting for the browser, or over. */
type Phase =
  | { readonly kind: "ready" }
  | { readonly kind: "starting" }
  | { readonly kind: "code"; readonly code: string; readonly url: string }
  | { readonly kind: "done"; readonly account: GitAccountRef }
  | { readonly kind: "failed"; readonly message: string };

const TOOLS: Readonly<Record<GitProvider, { readonly name: string; readonly command: string }>> = {
  github: { name: "GitHub", command: "gh" },
  gitlab: { name: "GitLab", command: "glab" },
};

/** What signing in changes outside APIWeave, said before it happens — what the tool does from a terminal too. */
function sideEffects(provider: GitProvider, host: string): string {
  return provider === "github"
    ? `gh makes this account its active account on ${host}, as gh auth login does in a terminal. Your git configuration is not changed.`
    : `glab keeps one account per host: this replaces any account it already has for ${host}. Your git configuration is not changed.`;
}

/**
 * Sign in to GitHub or GitLab with `gh` or `glab`, run by APIWeave — the user
 * never opens a terminal. Main runs the tool, opens the host's page in the
 * browser and shows its one-time code here; the dialog waits until the code
 * has been entered there. Cancel (or closing the dialog) stops the tool.
 * Mount it once per sign-in: it starts from `defaultHost` and the ready step.
 */
export function GitSignInDialog({
  isOpen,
  provider,
  defaultHost,
  onClose,
  onSignedIn,
}: GitSignInDialogProps) {
  const [host, setHost] = useState(defaultHost);
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const cancelling = useRef(false);
  const running = phase.kind === "starting" || phase.kind === "code";
  const tool = TOOLS[provider];

  // Unmounting with a sign-in still waiting stops its tool.
  const stillRunning = useRef(false);
  useEffect(() => {
    stillRunning.current = running;
  }, [running]);
  useEffect(
    () => () => {
      if (stillRunning.current) void git.cancelSignIn().catch(() => undefined);
    },
    [],
  );

  const start = async (): Promise<void> => {
    const target = host.trim();
    cancelling.current = false;
    setPhase({ kind: "starting" });
    const unsubscribe = git.onSignInPrompt((prompt) => {
      if (prompt.provider === provider && prompt.host === target) {
        setPhase({ kind: "code", code: prompt.code, url: prompt.url });
      }
    });
    try {
      const account = await git.signIn(provider, target);
      setPhase({ kind: "done", account });
      onSignedIn(account);
    } catch (error) {
      if (cancelling.current) {
        onClose();
        return;
      }
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      unsubscribe();
    }
  };

  const cancel = (): void => {
    cancelling.current = true;
    void git.cancelSignIn().catch(() => undefined);
  };

  const footer = () => {
    if (running) {
      return (
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={phase.kind !== "code"}
            onClick={() => void git.openSignInPage().catch(() => undefined)}
          >
            Open browser again
          </Button>
        </>
      );
    }
    if (phase.kind === "ready") {
      return (
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={host.trim() === ""} onClick={() => void start()}>
            Sign in in the browser
          </Button>
        </>
      );
    }
    return phase.kind === "failed" ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => void start()}>Try again</Button>
      </>
    ) : (
      <Button onClick={onClose}>Done</Button>
    );
  };

  const body = (() => {
    switch (phase.kind) {
      case "ready":
        return (
          <FormField label="Host" hint={`The ${tool.name} instance to sign in to.`}>
            <Input
              aria-label="Host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
        );
      case "starting":
        return (
          <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            <Spinner size="sm" />
            Starting {tool.command}…
          </div>
        );
      case "code":
        return (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              Enter this code on the page that opened in your browser, then
              come back here:
            </p>
            <p
              aria-label="One-time code"
              className="select-all font-mono text-2xl font-semibold tracking-widest text-text-primary dark:text-text-primary-dark"
            >
              {phase.code}
            </p>
            <p className="break-all font-mono text-xs text-text-muted dark:text-text-muted-dark">
              {phase.url}
            </p>
          </div>
        );
      case "done":
        return (
          <p className="text-sm text-text-primary dark:text-text-primary-dark">
            Signed in to {phase.account.host} as{" "}
            <strong className="font-semibold">{phase.account.login}</strong>.
          </p>
        );
      case "failed":
        return (
          <div
            role="alert"
            className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {phase.message}
          </div>
        );
    }
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={running ? cancel : onClose}
      title={`Sign in to ${tool.name}`}
      size="sm"
      headerExtra={
        <KeyRound
          className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      }
      footer={footer}
    >
      <div className="space-y-4 p-5">
        {body}
        {(phase.kind === "ready" || running) && (
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            {sideEffects(provider, host.trim() || defaultHost)}
          </p>
        )}
      </div>
    </Modal>
  );
}
