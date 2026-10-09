import ButtonSelect from "../ButtonSelect";
import { Input } from "../atoms/Input";
import { TextArea } from "../atoms/TextArea";
import { FormField } from "../molecules/FormField";
import { useTemplateAutocomplete } from "../molecules/TemplateAutocomplete";
import { MAX_JWT_LIFETIME_SECONDS } from "@shared/zod-schemas/AuthConfigSchema";
import { jsonObjectTemplateProblem } from "../../utils/jsonObjectTemplateProblem";
import { SecretNameField } from "./SecretNameField";
import type { JwtAuthConfig, SelectOption } from "../../types";

const ALGORITHM_OPTIONS: SelectOption[] = [
  { label: "HS256 (shared secret)", value: "HS256" },
  { label: "RS256 (RSA key)", value: "RS256" },
  { label: "ES256 (P-256 key)", value: "ES256" },
];

function JsonTemplateField({
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  const autocomplete = useTemplateAutocomplete<HTMLTextAreaElement>(
    value,
    onChange,
  );
  const error = jsonObjectTemplateProblem(value);
  return (
    <FormField label={label} hint={hint} {...(error ? { error } : {})}>
      <TextArea
        {...autocomplete.props}
        rows={rows}
        className="resize-y font-mono"
      />
      {autocomplete.list}
    </FormField>
  );
}

export function JwtAuthFields({
  config,
  onChange,
  buttonClass,
}: {
  config: JwtAuthConfig;
  onChange: (patch: Partial<JwtAuthConfig>) => void;
  buttonClass: string;
}) {
  const hmac = config.algorithm === "HS256";
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        A fresh token is signed for every request. It is masked in run
        results like a secret.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Algorithm">
          <ButtonSelect
            options={ALGORITHM_OPTIONS}
            value={config.algorithm}
            onChange={(algorithm) =>
              onChange({ algorithm: algorithm as JwtAuthConfig["algorithm"] })
            }
            buttonClass={buttonClass}
          />
        </FormField>
        <SecretNameField
          label={hmac ? "Shared secret" : "Private key"}
          hint={
            hmac
              ? "The name of the secret holding the HMAC key."
              : "The name of the secret holding the PEM private key. Line breaks may be lost or written as \\n."
          }
          error={config.secret ? "" : "Name the secret holding the signing key"}
          reference={config.secret}
          onChange={(secret) => onChange({ secret })}
          placeholder="JWT_SIGNING_KEY"
        />
      </div>
      <JsonTemplateField
        label="Payload"
        hint='The claims, a JSON object. Placeholders work; one standing alone, as in "sub": {{variables.userId}}, is inserted as a value. iat is added unless set.'
        value={config.payload}
        onChange={(payload) => onChange({ payload })}
        rows={6}
      />
      <JsonTemplateField
        label="Extra header fields"
        hint='Optional, e.g. {"kid": "key-1"}. alg and typ are set for you.'
        value={config.header ?? ""}
        onChange={(header) => onChange({ header })}
        rows={2}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          label="Expires in"
          hint="Seconds; adds exp unless the payload sets it. Empty: no exp."
        >
          <Input
            type="number"
            min={1}
            max={MAX_JWT_LIFETIME_SECONDS}
            value={config.expiresInSeconds ?? ""}
            onChange={(event) => {
              const seconds = Math.round(Number(event.target.value));
              onChange({
                expiresInSeconds:
                  seconds > 0
                    ? Math.min(seconds, MAX_JWT_LIFETIME_SECONDS)
                    : undefined,
              });
            }}
          />
        </FormField>
        <FormField label="Header" hint="Where the token is sent.">
          <Input
            value={config.headerName ?? "Authorization"}
            onChange={(event) => onChange({ headerName: event.target.value })}
            className="font-mono"
          />
        </FormField>
        <FormField label="Prefix" hint="Before the token. Empty: the bare token.">
          <Input
            value={config.prefix ?? "Bearer"}
            onChange={(event) => onChange({ prefix: event.target.value })}
            className="font-mono"
          />
        </FormField>
      </div>
    </div>
  );
}
