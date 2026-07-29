import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Cloud, LayoutGrid, Plus, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Modal } from "../molecules/Modal";
import { FormField } from "../molecules/FormField";
import { apiweave, authenticatedJson } from "../../utils/apiweaveClient";
import API_BASE_URL from "../../utils/apiweaveClient";
import { isDesktopShell } from "../../utils/isDesktopShell";
import type { CreateWorkspaceModalProps, Workspace } from "../../types";

// Workspace slugs use lowercase letters, numbers, and hyphens.
function toWorkspaceSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function isValidWorkspaceSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<Awaited<ReturnType<typeof apiweave.cloud.status>> | null>(null);
  const [owner, setOwner] = useState<"personal" | "existing" | "new">("personal");
  const [teamId, setTeamId] = useState("");
  const [newTeamName, setNewTeamName] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setSlug("");
      setDescription("");
      setServerError(null);
      setIsSubmitting(false);
      setCloudStatus(null);
      setOwner("personal");
      setTeamId("");
      setNewTeamName("");
      return;
    }
    let cancelled = false;
    void apiweave.cloud.status()
      .then((status) => status.linked && status.teamCatalog.length === 0
        ? apiweave.cloud.refreshWorkspaceCatalog()
        : status)
      .then((status) => {
        if (cancelled) return;
        setCloudStatus(status);
        const firstTeam = status.teamCatalog.find(
          (team) => !team.isPersonal && team.canCreateWorkspaces,
        );
        setTeamId(firstTeam?.teamId ?? "");
      })
      .catch(() => {
        if (!cancelled) setCloudStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const slugError =
    trimmedSlug && !isValidWorkspaceSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and hyphens; start and end with a letter or number."
      : null;
  const canUseTeams = cloudStatus?.linked === true;
  const availableTeams = cloudStatus?.teamCatalog.filter(
    (team) => !team.isPersonal && team.canCreateWorkspaces,
  ) ?? [];
  const hasOwner = owner === "personal"
    || (owner === "existing" && canUseTeams && Boolean(teamId))
    || (owner === "new" && canUseTeams && Boolean(newTeamName.trim()));
  const canSubmit = Boolean(trimmedName && trimmedSlug && !slugError && hasOwner);

  const handleNameChange = (value: string): void => {
    setName(value);
    setSlug(toWorkspaceSlug(value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setServerError(null);

    try {
      const workspace = isDesktopShell()
        ? owner === "personal"
          ? await apiweave.workspaces.create({
              name: trimmedName,
              slug: trimmedSlug,
              description: description.trim() || null,
              isPersonal: false,
            })
          : await apiweave.cloud.createTeamWorkspace({
              name: trimmedName,
              slug: trimmedSlug,
              description: description.trim() || null,
              ...(owner === "existing" ? { teamId } : { newTeamName: newTeamName.trim() }),
            })
        : await authenticatedJson<Workspace>(`${API_BASE_URL}/api/workspaces`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: trimmedName,
              slug: trimmedSlug,
              ownerType: "user",
              orgId: null,
              description: description.trim() || null,
            }),
          });
      await onCreated(workspace);
      toast.success(`Workspace "${workspace.name}" created`);
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create workspace";
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      title="Create workspace"
      size="md"
      headerExtra={
        <LayoutGrid
          className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      }
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-workspace-form"
            loading={isSubmitting}
            disabled={!canSubmit}
          >
            Create workspace
          </Button>
        </>
      )}
    >
      <form
        id="create-workspace-form"
        onSubmit={handleSubmit}
        className="space-y-4 p-5"
      >
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Choose who owns this Workspace. You can keep it personal or place it in a Cloud Team.
        </p>

        {serverError && (
          <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20">
            {serverError}
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Where should this Workspace live?
          </legend>
          <OwnershipOption
            checked={owner === "personal"}
            description={canUseTeams
              ? "Only you. It syncs through your personal Cloud space."
              : "Stored on this device. You can connect Cloud later."}
            icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
            label="Personal"
            onChange={() => setOwner("personal")}
          />
          <OwnershipOption
            checked={owner === "existing"}
            description={canUseTeams
              ? "Share ownership with a Team you can create Workspaces in."
              : "Connect APIWeave Cloud to choose a Team."}
            disabled={!canUseTeams || availableTeams.length === 0}
            icon={<Users className="h-4 w-4" aria-hidden="true" />}
            label="Existing Cloud Team"
            onChange={() => setOwner("existing")}
          />
          {owner === "existing" && canUseTeams && (
            <div className="pl-10">
              <label className="mb-1 block text-xs font-medium text-text-secondary dark:text-text-secondary-dark" htmlFor="workspace-team">
                Team
              </label>
              <select
                id="workspace-team"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                disabled={isSubmitting}
                className="h-10 w-full rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              >
                {availableTeams.map((team) => (
                  <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
                ))}
              </select>
            </div>
          )}
          <OwnershipOption
            checked={owner === "new"}
            description={canUseTeams
              ? "Create a Team, then place this Workspace inside it."
              : "Connect APIWeave Cloud to create a Team."}
            disabled={!canUseTeams}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            label="New Cloud Team"
            onChange={() => setOwner("new")}
          />
          {owner === "new" && canUseTeams && (
            <div className="pl-10">
              <label className="mb-1 block text-xs font-medium text-text-secondary dark:text-text-secondary-dark" htmlFor="new-team-name">
                Team name
              </label>
              <Input
                id="new-team-name"
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder="Platform Engineering"
                disabled={isSubmitting}
              />
            </div>
          )}
          {canUseTeams && availableTeams.length === 0 ? (
            <p className="flex items-center gap-1.5 pl-10 text-xs text-text-muted dark:text-text-muted-dark">
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              No existing Team allows Workspace creation. Create a new Team instead.
            </p>
          ) : null}
        </fieldset>

        <FormField label="Workspace name" required>
          <Input
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="QA Workspace"
            disabled={isSubmitting}
            autoFocus
          />
        </FormField>

        <FormField
          label="Slug"
          hint="Used in workspace URLs. Lowercase letters, numbers, and hyphens only."
          {...(slugError ? { error: slugError } : {})}
          required
        >
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="qa-workspace"
            disabled={isSubmitting}
            {...(slugError ? { error: slugError } : {})}
          />
        </FormField>

        <FormField
          label="Description"
          hint="Optional, shown in workspace settings."
        >
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Workspace for the QA team's API tests"
            disabled={isSubmitting}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function OwnershipOption({
  checked,
  description,
  disabled = false,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className={`flex min-h-14 items-start gap-3 rounded-sm border p-3 transition-colors ${
      checked
        ? "border-primary bg-primary/5 dark:border-primary-light dark:bg-primary-light/10"
        : "border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"}`}>
      <input
        type="radio"
        name="workspace-owner"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 accent-primary"
      />
      <span className="mt-0.5 text-text-secondary dark:text-text-secondary-dark">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">{label}</span>
        <span className="mt-0.5 block text-xs text-text-secondary dark:text-text-secondary-dark">{description}</span>
      </span>
    </label>
  );
}
