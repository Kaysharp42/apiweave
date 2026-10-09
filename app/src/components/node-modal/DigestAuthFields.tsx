import { FormField } from "../molecules/FormField";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { SecretNameField } from "./SecretNameField";
import type { DigestAuthConfig } from "../../types";

export function DigestAuthFields({
  config,
  onChange,
}: {
  config: DigestAuthConfig;
  onChange: (patch: Partial<DigestAuthConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        The request is sent, and sent once more with credentials when the
        server answers with a Digest challenge (MD5 or SHA-256, qop=auth). It
        does not follow redirects.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Username"
          error={config.username.trim() ? "" : "Enter the username"}
        >
          <TemplateInput
            value={config.username}
            onValueChange={(username) => onChange({ username })}
          />
        </FormField>
        <SecretNameField
          label="Password"
          hint="The name of a secret, sent as {{secrets.NAME}} — never the value itself."
          error={config.password ? "" : "Name the secret holding the password"}
          reference={config.password}
          onChange={(password) => onChange({ password })}
          placeholder="API_PASSWORD"
        />
      </div>
    </div>
  );
}
