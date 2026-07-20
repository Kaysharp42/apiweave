import { useState, useCallback } from "react";
import { Key } from "lucide-react";
import { Button } from "./atoms/Button";
import { Input } from "./atoms/Input";
import { FormField } from "./molecules/FormField";
import { Spinner } from "./atoms/Spinner";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import type { ServiceTokenCreateResponse } from "../types";

export interface ServiceTokenCreateFormProps {
  /** The scope type (workspace or organization). */
  scopeType: "workspace" | "organization";
  /** The scope ID. */
  scopeId: string;
  /** Called with the one-time token response after creation. */
  onCreated: (response: ServiceTokenCreateResponse) => void;
  className?: string;
}

const AVAILABLE_PERMISSIONS = [
  "secrets:read",
  "secrets:create",
  "secrets:update",
  "secrets:delete",
  "workflows:read",
  "workflows:create",
  "workflows:update",
  "workflows:delete",
  "workflows:run",
  "environments:read",
  "environments:update",
  "collections:read",
  "collections:update",
];

/**
 * ServiceTokenCreateForm — creates a service token with name, permissions,
 * and optional expiry. Returns the one-time token value via callback.
 */
export function ServiceTokenCreateForm({
  scopeType,
  scopeId,
  onCreated,
  className = "",
}: ServiceTokenCreateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const togglePermission = useCallback((perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setNameError(null);
      setError(null);

      if (!name.trim()) {
        setNameError("Token name is required");
        return;
      }

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          name: name.trim(),
          permissions: selectedPermissions,
        };

        if (description.trim()) {
          body.description = description.trim();
        }

        if (expiresAt) {
          body.expiresAt = new Date(expiresAt).toISOString();
        }

        const response = await authenticatedJson<ServiceTokenCreateResponse>(
          `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/tokens`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        // Clear form
        setName("");
        setDescription("");
        setSelectedPermissions([]);
        setExpiresAt("");

        // Pass the one-time token to parent
        onCreated(response);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create token";
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [
      name,
      description,
      selectedPermissions,
      expiresAt,
      scopeType,
      scopeId,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      <FormField
        label="Token name"
        required
        {...(nameError && { error: nameError })}
      >
        <Input
          type="text"
          placeholder="CI/CD Deploy Token"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          disabled={submitting}
        />
      </FormField>

      <FormField
        label="Description"
        hint="Optional — describe what this token is for"
      >
        <Input
          type="text"
          placeholder="Used by GitHub Actions for deployment"
          value={description}
          onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
          disabled={submitting}
        />
      </FormField>

      <FormField
        label="Permissions"
        hint="Select the permissions this token should have"
      >
        <div className="flex flex-wrap gap-1.5 mt-1">
          {AVAILABLE_PERMISSIONS.map((perm) => {
            const selected = selectedPermissions.includes(perm);
            return (
              <button
                key={perm}
                type="button"
                onClick={() => togglePermission(perm)}
                disabled={submitting}
                className={[
                  "px-2 py-1 text-xs rounded border transition-colors cursor-pointer",
                  selected
                    ? "bg-primary/10 dark:bg-primary-light/20 text-primary dark:text-primary-light border-primary/30 dark:border-primary-light/30"
                    : "bg-surface-overlay/50 dark:bg-surface-dark-overlay/50 text-text-secondary dark:text-text-secondary-dark border-border dark:border-border-dark hover:border-primary/30",
                ].join(" ")}
              >
                {perm}
              </button>
            );
          })}
        </div>
      </FormField>

      <FormField label="Expires at" hint="Leave empty for no expiration">
        <Input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
          disabled={submitting}
        />
      </FormField>

      {error && (
        <div
          className="text-sm text-status-error flex items-center gap-1.5"
          role="alert"
        >
          <Key className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          intent="success"
          size="sm"
          loading={submitting}
          disabled={submitting}
        >
          {submitting ? <Spinner size="sm" /> : null}
          Create token
        </Button>
      </div>
    </form>
  );
}
