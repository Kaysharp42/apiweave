import { useState, useCallback } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "./atoms/Button";
import { Input } from "./atoms/Input";
import { FormField } from "./molecules/FormField";
import { Spinner } from "./atoms/Spinner";
import { encryptSecretValue } from "../utils/encryptSecretValue";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";
import type { PublicKey, SecretScopeType } from "../types";

export interface SecretFormProps {
  /** The scope type this secret belongs to. */
  scopeType: SecretScopeType;
  /** The scope ID (e.g., workspace ID). */
  scopeId: string;
  /** Called after a secret is successfully created. */
  onCreated: () => void;
  /** Optional existing secret name for update mode. */
  existingSecretId?: string;
  className?: string;
}

/**
 * SecretForm — fetches the scope's public key, encrypts the value with
 * libsodium sealed-box, and POSTs the ciphertext.
 *
 * The plaintext value is cleared from state immediately after submission.
 */
export function SecretForm({
  scopeType,
  scopeId,
  onCreated,
  existingSecretId,
  className = "",
}: SecretFormProps) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);

  const isUpdate = !!existingSecretId;

  const validate = useCallback((): boolean => {
    let valid = true;
    setNameError(null);
    setValueError(null);

    if (!name.trim()) {
      setNameError("Secret name is required");
      valid = false;
    } else {
      const trimmed = name.trim();
      const firstChar = trimmed[0];
      if (!/[A-Za-z_]/.test(firstChar ?? "")) {
        setNameError("Secret name must start with a letter or underscore");
        valid = false;
      } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        const invalidChar = trimmed.match(/[^A-Za-z0-9_]/);
        setNameError(
          invalidChar
            ? `Secret name cannot contain "${invalidChar[0]}" — only letters, digits, and underscores are allowed`
            : "Secret name can only contain letters, digits, and underscores",
        );
        valid = false;
      }
    }

    if (!value) {
      setValueError("Secret value is required");
      valid = false;
    }

    return valid;
  }, [name, value]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      if (!scopeId) {
        setError(
          "Workspace is still loading. Please wait a moment and try again.",
        );
        return;
      }

      setSubmitting(true);
      setError(null);

      let step = "Failed to fetch encryption key";
      try {
        const publicKeyInfo = await authenticatedJson<PublicKey>(
          `${API_BASE_URL}/api/secrets/public-key?scope=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`,
        );

        step = "Failed to encrypt secret value";
        const ciphertext = await encryptSecretValue(value, {
          keyId: publicKeyInfo.keyId,
          publicKey: publicKeyInfo.publicKey,
          algorithm: "libsodium-sealed-box",
        });

        setValue("");

        step = "Failed to save secret";
        const url = isUpdate
          ? `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets/${encodeURIComponent(existingSecretId)}`
          : `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets`;

        await authenticatedJson(url, {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            ciphertext,
            keyId: publicKeyInfo.keyId,
          }),
        });

        setName("");
        setValue("");
        onCreated();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setError(`${step}: ${reason}`);
      } finally {
        setSubmitting(false);
      }
    },
    [
      validate,
      scopeType,
      scopeId,
      name,
      value,
      isUpdate,
      existingSecretId,
      onCreated,
    ],
  );

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={`space-y-4 ${className}`}
    >
      <FormField
        label="Secret name"
        required
        {...(nameError && { error: nameError })}
        hint="Letters, digits, underscores — must start with a letter or underscore"
      >
        <Input
          type="text"
          placeholder="API_TOKEN"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          disabled={submitting}
          className="font-mono"
        />
      </FormField>

      <FormField
        label="Secret value"
        required
        {...(valueError && { error: valueError })}
        hint="Encrypted client-side before sending"
      >
        <Input
          type="password"
          placeholder="Enter secret value"
          value={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
          disabled={submitting}
          autoComplete="new-password"
        />
      </FormField>

      {error && (
        <div
          className="text-sm text-status-error flex items-center gap-1.5"
          role="alert"
        >
          <KeyRound className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
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
          {isUpdate ? "Update secret" : "Add secret"}
        </Button>
      </div>
    </form>
  );
}
