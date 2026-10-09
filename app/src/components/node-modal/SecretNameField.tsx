import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";

const SECRET_REFERENCE = /^\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

/** The NAME in `{{secrets.NAME}}`, or "" when unset. */
export function secretNameOf(reference: string | undefined): string {
  return SECRET_REFERENCE.exec(reference ?? "")?.[1] ?? "";
}

/**
 * The reference stored for a typed secret name. Characters a secret name cannot
 * hold are dropped as they are typed, so the field can never hold a literal
 * credential — only a reference, or nothing.
 */
export function secretReferenceFor(typed: string): string {
  const name = typed.replace(/[^A-Za-z0-9_]/g, "").replace(/^[0-9]+/, "");
  return name ? `{{secrets.${name}}}` : "";
}

/** A secret field of an auth scheme: the user types a secret's NAME, the config stores `{{secrets.NAME}}`. */
export function SecretNameField({
  label,
  hint,
  error,
  reference,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  error: string;
  reference: string | undefined;
  onChange: (reference: string) => void;
  placeholder: string;
}) {
  return (
    <FormField label={label} hint={hint} error={error}>
      <Input
        value={secretNameOf(reference)}
        onChange={(event) => onChange(secretReferenceFor(event.target.value))}
        placeholder={placeholder}
        className="font-mono"
        aria-label={`${label} secret name`}
      />
    </FormField>
  );
}
