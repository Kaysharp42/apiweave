import { useEffect, useState, type FormEvent } from "react";
import { LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../atoms/Input";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import { FormField } from "../molecules/FormField";
import { apiweave } from "../../utils/apiweaveClient";
import type { CreateWorkspaceModalProps } from "../../types";

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

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setSlug("");
      setDescription("");
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const slugError =
    trimmedSlug && !isValidWorkspaceSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and hyphens; start and end with a letter or number."
      : null;
  const canSubmit = Boolean(trimmedName && trimmedSlug && !slugError) && !isSubmitting;

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
      const workspace = await apiweave.workspaces.create({
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || null,
        isPersonal: false,
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
        <ModalFormFooter
          formId="create-workspace-form"
          submitLabel="Create workspace"
          onCancel={onClose}
          busy={isSubmitting}
          canSubmit={canSubmit}
        />
      )}
    >
      <form
        id="create-workspace-form"
        onSubmit={handleSubmit}
        className="space-y-4 p-5"
      >
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          A workspace groups its own workflows, projects, environments and
          secrets. Everything stays on this device.
        </p>

        {serverError && (
          <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20">
            {serverError}
          </div>
        )}

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
