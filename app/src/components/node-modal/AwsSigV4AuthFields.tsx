import { FormField } from "../molecules/FormField";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { SecretNameField } from "./SecretNameField";
import type { AwsSigV4AuthConfig } from "../../types";

/** What each field is missing before a request can be signed; "" when it is fine. */
export function awsSigV4Problems(
  config: AwsSigV4AuthConfig,
): Record<"accessKeyId" | "secretAccessKey" | "region" | "service", string> {
  return {
    accessKeyId: config.accessKeyId.trim() ? "" : "Enter the access key ID",
    secretAccessKey: config.secretAccessKey
      ? ""
      : "Name the secret holding the secret access key",
    region: config.region.trim() ? "" : "Enter the region",
    service: config.service.trim() ? "" : "Enter the service",
  };
}

export function AwsSigV4AuthFields({
  config,
  onChange,
}: {
  config: AwsSigV4AuthConfig;
  onChange: (patch: Partial<AwsSigV4AuthConfig>) => void;
}) {
  const problems = awsSigV4Problems(config);
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        Signs the request as sent, after the pre-request script, on every
        attempt. A signed request does not follow redirects.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Access key ID" error={problems.accessKeyId}>
          <TemplateInput
            value={config.accessKeyId}
            onValueChange={(accessKeyId) => onChange({ accessKeyId })}
            placeholder="{{env.AWS_ACCESS_KEY_ID}}"
            className="font-mono"
          />
        </FormField>
        <SecretNameField
          label="Secret access key"
          hint="The name of a secret, sent as {{secrets.NAME}} — never the value itself."
          error={problems.secretAccessKey}
          reference={config.secretAccessKey}
          onChange={(secretAccessKey) => onChange({ secretAccessKey })}
          placeholder="AWS_SECRET_ACCESS_KEY"
        />
        <FormField label="Region" error={problems.region}>
          <TemplateInput
            value={config.region}
            onValueChange={(region) => onChange({ region })}
            placeholder="us-east-1"
          />
        </FormField>
        <FormField
          label="Service"
          hint="The service's signing name."
          error={problems.service}
        >
          <TemplateInput
            value={config.service}
            onValueChange={(service) => onChange({ service })}
            placeholder="execute-api"
          />
        </FormField>
        <SecretNameField
          label="Session token"
          hint="Optional, for temporary credentials. The name of a secret."
          error=""
          reference={config.sessionToken}
          onChange={(sessionToken) => onChange({ sessionToken })}
          placeholder="AWS_SESSION_TOKEN"
        />
      </div>
    </div>
  );
}
