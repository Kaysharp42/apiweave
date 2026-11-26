import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { KeyRound, Settings } from "lucide-react";
import { Button } from "../atoms/Button";
import { Card } from "../molecules/Card";
import { Modal } from "../molecules/Modal";
import { SecretForm } from "../SecretForm";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import useMissingRunInputsStore from "../../stores/MissingRunInputsStore";
import { apiweave } from "../../utils/apiweaveClient";
import type { MissingRunInput } from "@shared/types/MissingRunInput";
import type { RunInputCheck } from "@shared/types/RunInputCheck";
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal";
import type { SecretScopeType } from "../../types";

/** How many steps a row names before it counts the rest. */
const USES_SHOWN = 3;

/** "Login, Get user (in “Auth”) and 2 more" — the steps that read a value. */
function usedByText(input: MissingRunInput, workflowId: string): string {
  const names = input.usedBy.map((use) =>
    use.workflowId === workflowId ? use.nodeLabel : `${use.nodeLabel} (in “${use.workflowName || "Untitled"}”)`,
  );
  const shown = names.slice(0, USES_SHOWN).join(", ");
  const rest = names.length - USES_SHOWN;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** What the run was refused for, in a sentence: whose run, and that nothing went out. */
function introText(refusal: RunInputsRefusal, agent: string | null): string {
  const { target, checks } = refusal;
  const subject = target.kind === "project" ? `the project “${target.name}”` : `“${target.name || "Untitled"}”`;
  const reads =
    target.kind === "project"
      ? `${checks.length} of its ${checks.length === 1 ? "workflows reads" : "workflows read"}`
      : "it reads";
  const why = `${reads} environment variables or secrets that are not set or are empty`;
  return agent === null
    ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)} was not run: ${why}. Nothing was sent.`
    : `${agent} tried to run ${subject}, but ${why}, so it was not run and nothing was sent. Fix them below, then ask the agent to run it again — an agent cannot add or read secrets.`;
}

/** Where a secret's value is saved from this dialog. */
interface SecretTargetScope {
  readonly name: string;
  readonly scopeType: SecretScopeType;
  readonly scopeId: string;
  readonly scopeName: string;
}

/**
 * The scope a missing secret is fixed in: an empty one where it already sits
 * (a new value there is what the run will read), an unset one in the workspace.
 */
function secretTarget(input: MissingRunInput, check: RunInputCheck): SecretTargetScope {
  if (input.storedIn === "environment" && check.environment !== null) {
    return { name: input.name, scopeType: "environment", scopeId: check.environment.environmentId, scopeName: `environment “${check.environment.name}”` };
  }
  return { name: input.name, scopeType: "workspace", scopeId: check.workspaceId, scopeName: "the workspace" };
}

interface MissingRunInputRowProps {
  input: MissingRunInput;
  workflowId: string;
  action?: React.ReactNode;
}

function MissingRunInputRow({ input, workflowId, action }: MissingRunInputRowProps) {
  const scope = input.kind === "env" ? "env" : "secrets";
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm text-text-primary dark:text-text-primary-dark">{`{{${scope}.${input.name}}}`}</p>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {input.reason === "empty" ? "Empty" : "Not set"} · used by {usedByText(input, workflowId)}
        </p>
      </div>
      {action}
    </li>
  );
}

interface RunInputCheckSectionProps {
  check: RunInputCheck;
  /** Name the workflow above its cards: a project's refusal holds several. */
  showWorkflow: boolean;
  /** The workspace's route base, or null when it is not one this window can open. */
  base: string | null;
  onNavigate: (path: string) => void;
  onSetSecret: (target: SecretTargetScope) => void;
}

/** One workflow's missing values: its environment variables, then its secrets. */
function RunInputCheckSection({ check, showWorkflow, base, onNavigate, onSetSecret }: RunInputCheckSectionProps) {
  const env = check.missing.filter((input) => input.kind === "env");
  const secrets = check.missing.filter((input) => input.kind === "secret");
  const environment = check.environment;

  return (
    <section className="space-y-3">
      {showWorkflow && (
        <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          {check.workflowName || "Untitled"}
        </h3>
      )}

      {env.length > 0 && (
        <Card
          title="Environment variables"
          icon={Settings}
          {...(base === null
            ? {}
            : {
                headerActions: (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      onNavigate(
                        environment === null
                          ? `${base}/settings/environments`
                          : `${base}/settings/environments?edit=${encodeURIComponent(environment.environmentId)}`,
                      )
                    }
                  >
                    {environment === null ? "Open environments" : `Edit “${environment.name}”`}
                  </Button>
                ),
              })}
        >
          <div className="px-4 py-2">
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {environment === null
                ? "This run has no environment. Pick one, or create one that defines these."
                : `Not defined, or empty, in “${environment.name}” and the environments it extends. Give them a value in that environment.`}
            </p>
            <ul className="divide-y divide-border dark:divide-border-dark">
              {env.map((input) => (
                <MissingRunInputRow key={input.name} input={input} workflowId={check.workflowId} />
              ))}
            </ul>
          </div>
        </Card>
      )}

      {secrets.length > 0 && (
        <Card title="Secrets" icon={KeyRound}>
          <div className="px-4 py-2">
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {environment === null
                ? "No value in this workspace. Add each one as a workspace secret."
                : `No value in “${environment.name}” or the workspace. Add each one as a workspace secret here, or as a secret of “${environment.name}” from its settings to use it only there.`}
            </p>
            <ul className="divide-y divide-border dark:divide-border-dark">
              {secrets.map((input) => (
                <MissingRunInputRow
                  key={input.name}
                  input={input}
                  workflowId={check.workflowId}
                  action={
                    <Button variant="secondary" size="xs" onClick={() => onSetSecret(secretTarget(input, check))}>
                      {input.reason === "empty" ? "Set value" : "Add secret"}
                    </Button>
                  }
                />
              ))}
            </ul>
          </div>
        </Card>
      )}
    </section>
  );
}

/**
 * What a refused run was missing, and where each value goes.
 *
 * Opened by the canvas when its own Run finds values that are not set or are
 * empty, by a project run refused for the same reason, and by an agent's run
 * that main refused. Environment variables are edited on the environment, so
 * they link there; a secret is saved right here, because only the user can
 * add one — that is the whole reason an agent's refusal is shown to them.
 */
export function MissingRunInputsDialog() {
  const shown = useMissingRunInputsStore((s) => s.shown);
  const show = useMissingRunInputsStore((s) => s.show);
  const close = useMissingRunInputsStore((s) => s.close);
  const navigate = useNavigate();
  const { availableWorkspaces, currentOrg } = useWorkspace();
  const [settingSecret, setSettingSecret] = useState<SecretTargetScope | null>(null);

  if (shown === null) return null;
  const { refusal, agent } = shown;
  // Every check of one refusal is in one workspace: a run never spans two.
  const workspaceId = refusal.checks[0]!.workspaceId;
  const workspaceSlug = availableWorkspaces.find((w) => w.workspaceId === workspaceId)?.slug;
  const base = workspaceSlug === undefined ? null : `/${currentOrg?.slug ?? "personal"}/${workspaceSlug}`;

  const goTo = (path: string): void => {
    close();
    navigate(path);
  };

  /** Read every check again once a secret is saved: close when nothing is left. */
  const recheck = async (current: RunInputsRefusal): Promise<void> => {
    try {
      const checks = await Promise.all(
        current.checks.map((check) =>
          apiweave.runs.checkInputs({
            workspaceId: check.workspaceId,
            workflowId: check.workflowId,
            selectedEnvironmentId: check.environment?.environmentId ?? null,
          }),
        ),
      );
      const [first, ...rest] = checks.filter((check) => check.missing.length > 0);
      if (first !== undefined) {
        show({ target: current.target, checks: [first, ...rest] }, agent);
        return;
      }
      close();
      toast.success(agent === null ? "Every value is set — run it again." : `Every value is set — ask ${agent} to run it again.`);
    } catch {
      // The secret was saved; a failed re-read only leaves the list stale.
    }
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title="Missing environment variables and secrets"
      size="md"
      footer={() => (
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      )}
    >
      <div className="space-y-5 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">{introText(refusal, agent)}</p>

        {refusal.checks.map((check) => (
          <RunInputCheckSection
            key={check.workflowId}
            check={check}
            showWorkflow={refusal.target.kind === "project"}
            base={base}
            onNavigate={goTo}
            onSetSecret={setSettingSecret}
          />
        ))}

        {/* Nested in the dialog so a click in it is not a click outside the dialog. */}
        <Modal
          isOpen={settingSecret !== null}
          onClose={() => setSettingSecret(null)}
          title={settingSecret === null ? "" : `Save ${settingSecret.name} in ${settingSecret.scopeName}`}
          size="sm"
        >
          {settingSecret !== null && (
            <div className="p-5">
              <SecretForm
                scopeType={settingSecret.scopeType}
                scopeId={settingSecret.scopeId}
                defaultName={settingSecret.name}
                onCreated={() => {
                  toast.success(`Saved secret ${settingSecret.name}`);
                  setSettingSecret(null);
                  void recheck(refusal);
                }}
              />
            </div>
          )}
        </Modal>
      </div>
    </Modal>
  );
}
