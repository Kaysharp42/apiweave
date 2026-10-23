import { useEffect, useId, useRef, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import type { GitProvider } from "@shared/types/GitProvider";
import { GitHostSchema } from "@shared/zod-schemas/GitAccountRefSchema";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { git } from "../../utils/apiweaveClient";
import type { GitSignInDialogProps, GitSignInPhase } from "../../types";

const TOOLS: Readonly<Record<GitProvider, { readonly name: string; readonly command: string }>> = {
  github: { name: "GitHub", command: "gh" },
  gitlab: { name: "GitLab", command: "glab" },
};

/** What signing in changes outside APIWeave, said before it happens — what the tool does from a terminal too. */
function sideEffects(provider: GitProvider, host: string): string {
  return provider === "github"
    ? `gh makes this account its active account on ${host}, as gh auth login does in a terminal: gh commands, and repositories that use gh's credential helper, will act as this account. Your git configuration is not changed.`
    : `glab keeps one account per host: this replaces any account it already has for ${host}. It also sets glab's Git protocol for ${host} to HTTPS, and may make ${host} glab's default host. Your git configuration is not changed.`;
}

/** The browser step: the one-time code to enter, when the host has one, and the page it goes on. */
function BrowserStep({ code, url }: { readonly code: string | null; readonly url: string }) {
  const codeLabel = useId();
  if (code === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Finish signing in in your browser, on the page that opened, then
          come back here.
        </p>
        <p className="break-all font-mono text-xs text-text-muted dark:text-text-muted-dark">{url}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        Enter this code on the page that opened in your browser, then come back
        here.
      </p>
      <div>
        <span id={codeLabel} className="text-xs text-text-muted dark:text-text-muted-dark">
          One-time code
        </span>
        <div className="flex items-center gap-2">
          <p
            aria-labelledby={codeLabel}
            className="select-all font-mono text-2xl font-semibold tracking-widest text-text-primary dark:text-text-primary-dark"
          >
            {code}
          </p>
          <IconButton
            size="sm"
            tooltip="Copy one-time code"
            onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <p className="break-all font-mono text-xs text-text-muted dark:text-text-muted-dark">{url}</p>
    </div>
  );
}

/**
 * Sign in to GitHub or GitLab with `gh` or `glab`, run by APIWeave — the user
 * never opens a terminal. Main runs the tool, opens the host's page in the
 * browser and shows its one-time code here (a GitHub Enterprise Server with
 * no device flow has none: the browser alone finishes it); the dialog waits
 * until the browser part is done. Cancel (or closing the dialog) stops the
 * tool. Mount it once per sign-in: it starts from `defaultHost` and the
 * ready step.
 */
export function GitSignInDialog({
  isOpen,
  provider,
  defaultHost,
  onClose,
  onSignedIn,
}: GitSignInDialogProps) {
  const [host, setHost] = useState(defaultHost);
  const [phase, setPhase] = useState<GitSignInPhase>({ kind: "ready" });
  const cancelling = useRef(false);
  const running = phase.kind === "starting" || phase.kind === "browser";
  const hostValid = GitHostSchema.safeParse(host.trim()).success;
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
        setPhase({ kind: "browser", code: prompt.code, url: prompt.url });
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
            disabled={phase.kind !== "browser"}
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
          <Button disabled={!hostValid} onClick={() => void start()}>
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
          <FormField
            label="Host"
            hint={`The ${tool.name} instance to sign in to.`}
            {...(host.trim() === "" || hostValid ? {} : { error: "Enter a host name, such as github.com or gitlab.example.com." })}
          >
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
      case "browser":
        return <BrowserStep code={phase.code} url={phase.url} />;
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
        <div aria-live="polite">{body}</div>
        {(phase.kind === "ready" || running) && (
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            {sideEffects(provider, host.trim() || defaultHost)}
          </p>
        )}
      </div>
    </Modal>
  );
}
