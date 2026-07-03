import { useEffect, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Modal } from "../molecules/Modal";
import { FormField } from "../molecules/FormField";
import { authenticatedJson } from "../../utils/authenticatedApi";
import API_BASE_URL from "../../utils/api";
import type { CreateOrganizationModalProps, Organization } from "../../types";

function toOrgSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "organization";
  return /^[0-9]/.test(slug) ? `org_${slug}` : slug;
}

function isValidOrgSlug(value: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(value);
}

export function CreateOrganizationModal({
  isOpen,
  onClose,
  onCreated,
}: CreateOrganizationModalProps) {
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
    trimmedSlug && !isValidOrgSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and underscores; do not start with a number."
      : null;
  const canSubmit = Boolean(trimmedName && trimmedSlug && !slugError);

  const handleNameChange = (value: string): void => {
    setName(value);
    setSlug(toOrgSlug(value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setServerError(null);

    try {
      const organization = await authenticatedJson<Organization>(
        `${API_BASE_URL}/api/orgs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            slug: trimmedSlug,
            description: description.trim() || null,
          }),
        },
      );
      await onCreated(organization);
      toast.success(`Organization "${organization.name}" created`);
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create organization";
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
      title="Create organization"
      size="sm"
      headerExtra={
        <Building2
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
            form="create-organization-form"
            loading={isSubmitting}
            disabled={!canSubmit}
          >
            Create organization
          </Button>
        </>
      )}
    >
      <form
        id="create-organization-form"
        onSubmit={handleSubmit}
        className="space-y-4 p-5"
      >
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Organizations group team-owned workspaces, members, teams, and shared
          settings.
        </p>

        {serverError && (
          <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20">
            {serverError}
          </div>
        )}

        <FormField label="Organization name" required>
          <Input
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="Acme QA"
            disabled={isSubmitting}
            autoFocus
          />
        </FormField>

        <FormField
          label="Slug"
          hint="Used in workspace URLs. Lowercase letters, numbers, and underscores only."
          {...(slugError ? { error: slugError } : {})}
          required
        >
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="acme_qa"
            disabled={isSubmitting}
            {...(slugError ? { error: slugError } : {})}
          />
        </FormField>

        <FormField
          label="Description"
          hint="Optional, shown in organization settings."
        >
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="API testing workspace for the QA team"
            disabled={isSubmitting}
          />
        </FormField>
      </form>
    </Modal>
  );
}
