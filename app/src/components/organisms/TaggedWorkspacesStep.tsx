import { CheckCircle2, CircleAlert, CircleDot } from "lucide-react";
import { Spinner } from "../atoms/Spinner";
import { CheckboxOption } from "../molecules/CheckboxOption";
import type {
  TaggedWorkspaceOutcome,
  TaggedWorkspacesStepProps,
} from "../../types";

const SECONDARY = "text-text-secondary dark:text-text-secondary-dark";

/** One repository's result, after the open was tried. */
function OutcomeRow({
  fullName,
  outcome,
}: {
  readonly fullName: string;
  readonly outcome: TaggedWorkspaceOutcome;
}) {
  if (outcome.kind === "failed") {
    return (
      <li className="flex items-start gap-2 text-sm">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-error" aria-hidden="true" />
        <span className="min-w-0 text-text-primary dark:text-text-primary-dark">
          <span className="font-mono">{fullName}</span>
          <span className="block text-status-error">Not opened: {outcome.message}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
      <span className="min-w-0 text-text-primary dark:text-text-primary-dark">
        <span className="font-mono">{fullName}</span>
        <span className={`block ${SECONDARY}`}>
          {outcome.kind === "opened"
            ? `Opened as ${outcome.name}`
            : `Already here as ${outcome.name}`}
        </span>
        {outcome.kind === "opened" &&
          outcome.warnings.map((warning) => (
            <span key={warning} className={`block text-xs ${SECONDARY}`}>
              {warning}
            </span>
          ))}
      </span>
    </li>
  );
}

/**
 * The end of a sign-in: which of the account's `apiweave-workspace`
 * repositories hold a workspace not here yet, to tick and open — never cloned
 * without being asked. A workspace the user removed from this machine is
 * offered again, and they leave it unticked.
 */
export function TaggedWorkspacesStep({ account, feed }: TaggedWorkspacesStepProps) {
  const tried = feed.opening !== null || feed.finished;

  const list = (() => {
    if (feed.loading) {
      return (
        <div className={`flex items-center gap-2 text-sm ${SECONDARY}`}>
          <Spinner size="sm" />
          Looking for workspaces this account keeps in git…
        </div>
      );
    }
    if (feed.failure !== null) {
      return (
        <p className={`text-sm ${SECONDARY}`}>
          The account's workspace repositories could not be listed: {feed.failure}
        </p>
      );
    }
    if (feed.repositories.length === 0) {
      return (
        <p className={`text-sm ${SECONDARY}`}>
          No repository this account has tagged <code className="font-mono">apiweave-workspace</code>{" "}
          holds a workspace that is not already here.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className={`text-sm ${SECONDARY}`}>
          These repositories tagged <code className="font-mono">apiweave-workspace</code> hold
          workspaces that are not on this computer yet. Open the ones you want here.
        </p>
        <ul className="space-y-2" aria-label="Workspaces to open">
          {feed.repositories.map((repository) => {
            const outcome = feed.outcomes.get(repository.fullName);
            if (outcome !== undefined) {
              return (
                <OutcomeRow
                  key={repository.fullName}
                  fullName={repository.fullName}
                  outcome={outcome}
                />
              );
            }
            if (feed.opening === repository.fullName) {
              return (
                <li key={repository.fullName} className="flex items-center gap-2 text-sm">
                  <Spinner size="sm" />
                  <span className="font-mono text-text-primary dark:text-text-primary-dark">
                    Opening {repository.fullName}…
                  </span>
                </li>
              );
            }
            if (tried) {
              return (
                <li key={repository.fullName} className={`flex items-center gap-2 text-sm ${SECONDARY}`}>
                  <CircleDot className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="font-mono">{repository.fullName}</span>
                  {!feed.selected.has(repository.fullName) && <span>(not opened)</span>}
                </li>
              );
            }
            return (
              <li key={repository.fullName}>
                <CheckboxOption
                  label={repository.fullName}
                  checked={feed.selected.has(repository.fullName)}
                  onChange={(checked) => feed.toggle(repository.fullName, checked)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    );
  })();

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-primary dark:text-text-primary-dark">
        Signed in to {account.host} as{" "}
        <strong className="font-semibold">{account.login}</strong>.
      </p>
      {list}
      {feed.problems.length > 0 && (
        <ul className={`space-y-1 text-xs ${SECONDARY}`}>
          {feed.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
