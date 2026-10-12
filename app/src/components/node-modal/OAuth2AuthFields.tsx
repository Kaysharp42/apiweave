import { useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ButtonSelect from "../ButtonSelect";
import { Button } from "../atoms/Button";
import { FormField } from "../molecules/FormField";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { SecretNameField } from "./SecretNameField";
import WorkflowContext from "../../contexts/WorkflowContext";
import WorkspaceContext from "../../contexts/WorkspaceContext";
import useEnvironmentStore, {
  getSelectedEnvironment,
} from "../../stores/EnvironmentStore";
import { oauth } from "../../utils/apiweaveClient";
import type {
  OAuth2AuthConfig,
  OAuth2AuthFieldsProps,
  OAuth2Field,
  OAuth2TokenControlsProps,
  OAuthTokenStatus,
  SelectOption,
} from "../../types";

const GRANT_OPTIONS: SelectOption[] = [
  { label: "Client credentials", value: "client_credentials" },
  { label: "Authorization code (PKCE)", value: "authorization_code" },
];

const CLIENT_AUTH_OPTIONS: SelectOption[] = [
  { label: "Basic auth header", value: "basic" },
  { label: "Client ID and secret in body", value: "body" },
];

/** What each field is missing before a token can be fetched; "" when it is fine. */
export function oauth2Problems(
  config: OAuth2AuthConfig,
): Record<OAuth2Field, string> {
  const codeGrant = config.grantType === "authorization_code";
  return {
    tokenUrl: config.tokenUrl.trim() ? "" : "Enter the token URL",
    clientId: config.clientId.trim() ? "" : "Enter the client ID",
    clientSecret:
      codeGrant || config.clientSecret
        ? ""
        : "Client credentials need a client secret",
    authorizationUrl:
      !codeGrant || config.authorizationUrl?.trim()
        ? ""
        : "Enter the authorization URL",
    tokenSecret:
      !codeGrant || config.tokenSecret
        ? ""
        : "Name the secret to store the token in",
  };
}

function formatStatus(status: OAuthTokenStatus): string {
  const who = status.authorizedAs
    ? `Authorized as ${status.authorizedAs}`
    : "Token stored";
  if (!status.expiresAt) return who;
  const expires = new Date(status.expiresAt);
  const verb = expires.getTime() > Date.now() ? "expires" : "expired";
  const refresh = status.hasRefreshToken ? " (refreshed automatically)" : "";
  return `${who} · access token ${verb} ${expires.toLocaleString()}${refresh}`;
}

/** The workspace and environment a run of the open workflow would use. */
function useTokenScope(): {
  workspaceId: string | null;
  environmentId: string | null;
} {
  const workflow = useContext(WorkflowContext);
  const workspace = useContext(WorkspaceContext);
  const workflowId = workflow?.workflowId;
  const selectedEnvMap = useEnvironmentStore(
    (state) => state.selectedEnvironmentByWorkflow,
  );
  const environmentId = useMemo(
    () => (workflowId ? getSelectedEnvironment(workflowId) : null),
    // The resolver reads the store imperatively; this is what re-runs it.
    [workflowId, selectedEnvMap],
  );
  return {
    workspaceId: workspace?.currentWorkspace?.workspaceId ?? null,
    environmentId,
  };
}

function TokenControls({ config, ready }: OAuth2TokenControlsProps) {
  const { workspaceId, environmentId } = useTokenScope();
  const [status, setStatus] = useState<OAuthTokenStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useMemo(
    () =>
      workspaceId && config.tokenSecret
        ? { workspaceId, environmentId, oauth2: config }
        : null,
    [workspaceId, environmentId, config],
  );
  const statusKey = request
    ? `${workspaceId}:${environmentId ?? ""}:${config.tokenSecret}`
    : null;

  useEffect(() => {
    if (!request) return undefined;
    let active = true;
    oauth.status(request).then(
      (next) => active && setStatus(next),
      () => active && setStatus(null),
    );
    return () => {
      active = false;
    };
    // Status depends on where the token lives, not on every field edit.
  }, [statusKey]);

  const act = async (
    action: "authorize" | "clear",
    done: string,
  ): Promise<void> => {
    if (!request) return;
    setBusy(true);
    try {
      setStatus(await oauth[action](request));
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={!request || !ready || busy}
          onClick={() => void act("authorize", "Signed in. Token stored.")}
        >
          Get token
        </Button>
        {status?.stored && (
          <Button
            size="sm"
            variant="ghost"
            intent="error"
            disabled={busy}
            onClick={() => void act("clear", "Token cleared.")}
          >
            Clear token
          </Button>
        )}
      </div>
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        {busy
          ? "Waiting for you to sign in in your browser…"
          : status?.stored
            ? formatStatus(status)
            : "No token yet. Get token opens your browser to sign in; runs then use and refresh the stored token."}
      </p>
    </div>
  );
}

export function OAuth2AuthFields({
  config,
  onChange,
  buttonClass,
}: OAuth2AuthFieldsProps) {
  const problems = oauth2Problems(config);
  const authorizationCode = config.grantType === "authorization_code";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Grant type"
          hint={
            authorizationCode
              ? "Sign in once in the app. The CLI uses a refresh token instead."
              : "Headless: works in the app and the CLI."
          }
        >
          <ButtonSelect
            options={GRANT_OPTIONS}
            value={config.grantType}
            onChange={(grantType) =>
              onChange({
                grantType: grantType as OAuth2AuthConfig["grantType"],
              })
            }
            buttonClass={buttonClass}
          />
        </FormField>
        <FormField label="Client authentication">
          <ButtonSelect
            options={CLIENT_AUTH_OPTIONS}
            value={config.clientAuth ?? "basic"}
            onChange={(clientAuth) =>
              onChange({
                clientAuth: clientAuth as OAuth2AuthConfig["clientAuth"],
              })
            }
            buttonClass={buttonClass}
          />
        </FormField>
      </div>
      {authorizationCode && (
        <FormField label="Authorization URL" error={problems.authorizationUrl}>
          <TemplateInput
            value={config.authorizationUrl ?? ""}
            onValueChange={(authorizationUrl) => onChange({ authorizationUrl })}
            placeholder="https://auth.example.com/authorize"
            className="font-mono"
          />
        </FormField>
      )}
      <FormField label="Token URL" error={problems.tokenUrl}>
        <TemplateInput
          value={config.tokenUrl}
          onValueChange={(tokenUrl) => onChange({ tokenUrl })}
          placeholder="https://auth.example.com/oauth/token"
          className="font-mono"
        />
      </FormField>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Client ID" error={problems.clientId}>
          <TemplateInput
            value={config.clientId}
            onValueChange={(clientId) => onChange({ clientId })}
          />
        </FormField>
        <SecretNameField
          label="Client secret"
          hint={
            authorizationCode
              ? "Optional. The name of a secret, sent as {{secrets.NAME}} — never the value itself."
              : "The name of a secret, sent as {{secrets.NAME}} — never the value itself."
          }
          error={problems.clientSecret}
          reference={config.clientSecret}
          onChange={(clientSecret) => onChange({ clientSecret })}
          placeholder="CLIENT_SECRET"
        />
        <FormField label="Scope" hint="Space-separated.">
          <TemplateInput
            value={config.scope ?? ""}
            onValueChange={(scope) => onChange({ scope })}
            placeholder="read write"
          />
        </FormField>
        <FormField label="Audience" hint="Optional.">
          <TemplateInput
            value={config.audience ?? ""}
            onValueChange={(audience) => onChange({ audience })}
          />
        </FormField>
      </div>
      {authorizationCode && (
        <>
          <SecretNameField
            label="Store token in secret"
            hint="Get token seals the access and refresh token into this secret. In the CLI, set it to a refresh token."
            error={problems.tokenSecret}
            reference={config.tokenSecret}
            onChange={(tokenSecret) => onChange({ tokenSecret })}
            placeholder="API_OAUTH_TOKEN"
          />
          <TokenControls
            config={config}
            ready={Object.values(problems).every((problem) => !problem)}
          />
        </>
      )}
    </div>
  );
}
