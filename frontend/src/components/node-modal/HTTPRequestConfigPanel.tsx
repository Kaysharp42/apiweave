import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  File,
  FileText,
  KeyRound,
  Link2,
  Type,
  type LucideIcon,
} from "lucide-react";
import ButtonSelect from "../ButtonSelect";
import FileUploadSection from "../FileUploadSection";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { IconSwitch } from "../atoms/IconSwitch";
import { Input } from "../atoms/Input";
import { TextArea } from "../atoms/TextArea";
import { Toggle } from "../atoms/Toggle";
import { BeautifyButton } from "../molecules/BeautifyButton";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { KeyValueEditor } from "../molecules/KeyValueEditor";
import { normalizeHttpRequestConfig } from "./httpRequestConfigCompat";
import type {
  AuthConfig,
  FileUpload,
  FormDataEntry,
  HTTPRequestBodyType,
  HTTPRequestConfigPanelProps,
  KeyValuePair,
  NodeModalHTTPRequestConfig,
  SelectOption,
  UrlEncodedEntry,
} from "../../types";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const AUTH_OPTIONS: SelectOption[] = [
  { label: "None", value: "none" },
  { label: "Bearer Token", value: "bearer" },
  { label: "Basic Auth", value: "basic" },
  { label: "API Key", value: "apiKey" },
];

const BODY_TYPES: Array<{ label: string; value: HTTPRequestBodyType }> = [
  { label: "None", value: "none" },
  { label: "JSON", value: "json" },
  { label: "Raw", value: "raw" },
  { label: "Form-data", value: "form-data" },
  { label: "x-www-form-urlencoded", value: "x-www-form-urlencoded" },
  { label: "Binary", value: "binary" },
];

function createCardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const FileTextCardIcon = createCardIcon(FileText);
const KeyRoundCardIcon = createCardIcon(KeyRound);
const Link2CardIcon = createCardIcon(Link2);
const TypeCardIcon = createCardIcon(Type);

function useDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const syncDarkMode = () => setIsDarkMode(root.classList.contains("dark"));
    const observer = new MutationObserver(syncDarkMode);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDarkMode;
}

function buildPreviewUrl(url: string, pairs: KeyValuePair[]): string {
  const activePairs = pairs.filter((pair) => pair.key.trim());
  if (activePairs.length === 0)
    return url || "https://api.example.com/resource";
  const query = activePairs
    .map(
      (pair) =>
        `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`,
    )
    .join("&");
  const separator = url.includes("?") ? "&" : "?";
  return `${url || "https://api.example.com/resource"}${separator}${query}`;
}

function HighlightedTemplateText({ value }: { value: string }) {
  const parts = value.split(/({{[^}]+}})/g);
  return (
    <span className="font-mono text-xs break-all text-text-secondary dark:text-text-secondary-dark">
      {parts.map((part, index) =>
        part.startsWith("{{") && part.endsWith("}}") ? (
          <span
            key={`${part}-${index}`}
            className="rounded-sm bg-primary/10 px-1 text-primary dark:bg-primary-light/10 dark:text-primary-light"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function validateJson(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    JSON.parse(value) as unknown;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
}

export function HTTPRequestConfigPanel({
  initialConfig,
  workingDataRef,
  activeTab,
  config,
  onConfigChange,
}: HTTPRequestConfigPanelProps) {
  const isDarkMode = useDarkMode();
  const [draftConfig, setDraftConfig] = useState<NodeModalHTTPRequestConfig>(
    () => normalizeHttpRequestConfig(config ?? initialConfig),
  );
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [showBasicPassword, setShowBasicPassword] = useState(false);

  useEffect(() => {
    setDraftConfig(normalizeHttpRequestConfig(config ?? initialConfig));
  }, [config, initialConfig]);

  const jsonError = useMemo(
    () =>
      draftConfig.bodyType === "json"
        ? validateJson(draftConfig.body || "")
        : undefined,
    [draftConfig.body, draftConfig.bodyType],
  );
  const previewUrl = useMemo(
    () =>
      buildPreviewUrl(
        draftConfig.url || "",
        (draftConfig.queryParams || []) as KeyValuePair[],
      ),
    [draftConfig.queryParams, draftConfig.url],
  );

  const updateConfig = (patch: Partial<NodeModalHTTPRequestConfig>) => {
    const newConfig = normalizeHttpRequestConfig({ ...draftConfig, ...patch });
    setDraftConfig(newConfig);
    workingDataRef.current = {
      ...workingDataRef.current,
      config: { ...newConfig },
    };
    onConfigChange?.(newConfig);
  };

  const updateAuth = (authPatch: Partial<AuthConfig>) => {
    updateConfig({
      auth: { ...(draftConfig.auth || { type: "none" }), ...authPatch },
    });
  };

  const renderParams = () => (
    <Card title="Query parameters" icon={Link2CardIcon}>
      <FormField
        label="Params"
        hint="Legacy key=value lines are converted into rows on load."
      >
        <KeyValueEditor
          pairs={(draftConfig.queryParams || []) as KeyValuePair[]}
          onChange={(queryParams) => updateConfig({ queryParams })}
          keyPlaceholder="page"
          valuePlaceholder="1"
        />
      </FormField>
      <div className="mt-4 rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
          Full URL preview
        </p>
        <HighlightedTemplateText value={previewUrl} />
      </div>
    </Card>
  );

  const renderAuth = () => {
    const auth = draftConfig.auth || { type: "none" };
    return (
      <Card title="Authorization" icon={KeyRoundCardIcon}>
        <div className="space-y-4">
          <FormField
            label="Auth type"
            hint="These credentials are stored with the workflow. Use {{secrets.NAME}} for sensitive values."
          >
            <ButtonSelect
              options={AUTH_OPTIONS}
              value={auth.type}
              onChange={(value) =>
                updateAuth({ type: value as AuthConfig["type"] })
              }
              buttonClass="flex h-10 w-full items-center justify-between rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
            />
          </FormField>

          {auth.type === "bearer" && (
            <FormField label="Bearer token">
              <div className="flex gap-2">
                <Input
                  type={showBearerToken ? "text" : "password"}
                  value={auth.bearer?.token || ""}
                  onChange={(event) =>
                    updateAuth({ bearer: { token: event.target.value } })
                  }
                  placeholder="{{secrets.API_TOKEN}}"
                  className="font-mono"
                />
                <IconButton
                  tooltip={showBearerToken ? "Hide token" : "Show token"}
                  variant="secondary"
                  onClick={() => setShowBearerToken((shown) => !shown)}
                >
                  {showBearerToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </IconButton>
              </div>
            </FormField>
          )}

          {auth.type === "basic" && (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Username">
                <Input
                  value={auth.basic?.username || ""}
                  onChange={(event) =>
                    updateAuth({
                      basic: {
                        username: event.target.value,
                        password: auth.basic?.password || "",
                      },
                    })
                  }
                />
              </FormField>
              <FormField label="Password">
                <div className="flex gap-2">
                  <Input
                    type={showBasicPassword ? "text" : "password"}
                    value={auth.basic?.password || ""}
                    onChange={(event) =>
                      updateAuth({
                        basic: {
                          username: auth.basic?.username || "",
                          password: event.target.value,
                        },
                      })
                    }
                  />
                  <IconButton
                    tooltip={
                      showBasicPassword ? "Hide password" : "Show password"
                    }
                    variant="secondary"
                    onClick={() => setShowBasicPassword((shown) => !shown)}
                  >
                    {showBasicPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </IconButton>
                </div>
              </FormField>
            </div>
          )}

          {auth.type === "apiKey" && (
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <FormField label="Key name">
                <Input
                  value={auth.apiKey?.key || ""}
                  onChange={(event) =>
                    updateAuth({
                      apiKey: {
                        key: event.target.value,
                        value: auth.apiKey?.value || "",
                        addTo: auth.apiKey?.addTo || "header",
                      },
                    })
                  }
                  placeholder="X-API-Key"
                />
              </FormField>
              <FormField label="Value">
                <Input
                  value={auth.apiKey?.value || ""}
                  onChange={(event) =>
                    updateAuth({
                      apiKey: {
                        key: auth.apiKey?.key || "",
                        value: event.target.value,
                        addTo: auth.apiKey?.addTo || "header",
                      },
                    })
                  }
                  placeholder="{{secrets.API_KEY}}"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Add to">
                <div className="flex h-10 items-center gap-2">
                  <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                    Query
                  </span>
                  <IconSwitch
                    checked={(auth.apiKey?.addTo || "header") === "header"}
                    onCheckedChange={(checked) =>
                      updateAuth({
                        apiKey: {
                          key: auth.apiKey?.key || "",
                          value: auth.apiKey?.value || "",
                          addTo: checked ? "header" : "query",
                        },
                      })
                    }
                    checkedIcon={<KeyRound className="h-3 w-3" />}
                    uncheckedIcon={<Link2 className="h-3 w-3" />}
                    checkedLabel="Header"
                    uncheckedLabel="Query"
                  />
                  <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                    Header
                  </span>
                </div>
              </FormField>
            </div>
          )}
        </div>
      </Card>
    );
  };

  const renderBody = () => (
    <Card
      title="Request body"
      icon={FileTextCardIcon}
      className="min-h-[34rem]"
    >
      <div className="mb-4 flex flex-wrap gap-1 rounded-sm border border-border bg-surface-overlay p-1 dark:border-border-dark dark:bg-surface-dark-overlay">
        {BODY_TYPES.map((bodyType) => (
          <Button
            key={bodyType.value}
            size="xs"
            variant={
              draftConfig.bodyType === bodyType.value ? "primary" : "ghost"
            }
            onClick={() => updateConfig({ bodyType: bodyType.value })}
          >
            {bodyType.label}
          </Button>
        ))}
      </div>

      {draftConfig.bodyType === "none" && (
        <div className="rounded-sm border border-dashed border-border bg-surface-overlay p-8 text-center text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
          This request will be sent without a body.
        </div>
      )}

      {draftConfig.bodyType === "json" && (
        <FormField
          label="JSON body"
          {...(jsonError ? { error: jsonError } : {})}
        >
          <div
            className={[
              "overflow-hidden rounded-sm border",
              jsonError
                ? "border-status-error dark:border-[var(--aw-status-error)]"
                : "border-border dark:border-border-dark",
            ].join(" ")}
          >
            <div className="flex items-center justify-end border-b border-border bg-surface-overlay px-2 py-1 dark:border-border-dark dark:bg-surface-dark-overlay">
              <BeautifyButton
                value={draftConfig.body || ""}
                onChange={(body) => updateConfig({ body })}
              />
            </div>
            <Suspense
              fallback={
                <div className="h-[400px] p-4 text-sm text-text-secondary dark:text-text-secondary-dark">
                  Loading editor…
                </div>
              }
            >
              <MonacoEditor
                height="400px"
                language="json"
                theme={isDarkMode ? "vs-dark" : "light"}
                value={draftConfig.body || ""}
                onChange={(body) => updateConfig({ body: body || "" })}
                options={{
                  minimap: { enabled: false },
                  fontFamily: "JetBrains Mono",
                  scrollBeyondLastLine: false,
                }}
              />
            </Suspense>
          </div>
        </FormField>
      )}

      {draftConfig.bodyType === "raw" && (
        <FormField label="Raw body">
          <TextArea
            value={draftConfig.body || ""}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              updateConfig({ body: event.target.value })
            }
            autoResize
            rows={10}
            className="font-mono"
          />
        </FormField>
      )}

      {draftConfig.bodyType === "form-data" && (
        <FormDataRows
          entries={draftConfig.formDataEntries || []}
          onChange={(formDataEntries) => updateConfig({ formDataEntries })}
        />
      )}

      {draftConfig.bodyType === "x-www-form-urlencoded" && (
        <FormField label="URL encoded fields">
          <KeyValueEditor
            pairs={draftConfig.urlEncodedEntries || []}
            onChange={(pairs) =>
              updateConfig({
                urlEncodedEntries: pairs.map(
                  (pair): UrlEncodedEntry => ({ ...pair, active: true }),
                ),
              })
            }
          />
        </FormField>
      )}

      {draftConfig.bodyType === "binary" && (
        <FormField
          label="Binary file"
          hint="Use the existing file upload workflow to embed, reference, or source a binary file."
        >
          <FileUploadSection
            fileUploads={draftConfig.fileUploads || []}
            onUpdate={(fileUploads: FileUpload[]) =>
              updateConfig({ fileUploads })
            }
          />
        </FormField>
      )}
    </Card>
  );

  const renderSettings = () => (
    <Card title="Request settings" icon={TypeCardIcon}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Timeout" hint="Seconds, between 1 and 300.">
          <Input
            type="number"
            min={1}
            max={300}
            value={draftConfig.timeout ?? 30}
            onChange={(event) =>
              updateConfig({ timeout: Number(event.target.value) || 30 })
            }
          />
        </FormField>
        <FormField label="Follow redirects">
          <Toggle
            checked={draftConfig.followRedirects ?? true}
            onChange={(event) =>
              updateConfig({ followRedirects: event.target.checked })
            }
          />
        </FormField>
        <FormField label="SSL verify">
          <Toggle
            checked={draftConfig.sslVerify ?? true}
            onChange={(event) =>
              updateConfig({ sslVerify: event.target.checked })
            }
          />
        </FormField>
        <FormField label="Continue on failure">
          <Toggle
            checked={draftConfig.continueOnFail ?? false}
            onChange={(event) =>
              updateConfig({ continueOnFail: event.target.checked })
            }
          />
        </FormField>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      {activeTab === "params" && renderParams()}
      {activeTab === "auth" && renderAuth()}
      {activeTab === "headers" && (
        <Card title="Headers" icon={FileTextCardIcon}>
          <FormField label="Header rows">
            <KeyValueEditor
              pairs={(draftConfig.headers || []) as KeyValuePair[]}
              onChange={(headers) => updateConfig({ headers })}
              keyPlaceholder="Content-Type"
              valuePlaceholder="application/json"
            />
          </FormField>
        </Card>
      )}
      {activeTab === "body" && renderBody()}
      {activeTab === "cookies" && (
        <Card title="Cookies" icon={KeyRoundCardIcon}>
          <FormField label="Cookie rows" hint="Single line key=value cookies.">
            <KeyValueEditor
              pairs={(draftConfig.cookies || []) as KeyValuePair[]}
              onChange={(cookies) => updateConfig({ cookies })}
              keyPlaceholder="session"
              valuePlaceholder="{{variables.sessionId}}"
            />
          </FormField>
        </Card>
      )}
      {activeTab === "settings" && renderSettings()}
      {jsonError && activeTab === "body" && (
        <div className="flex items-center gap-2 rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:border-[var(--aw-status-error)]/30 dark:bg-[var(--aw-status-error)]/10 dark:text-[var(--aw-status-error)]">
          <AlertTriangle className="h-4 w-4" />
          {jsonError}
        </div>
      )}
    </div>
  );
}

function FormDataRows({
  entries,
  onChange,
}: {
  entries: FormDataEntry[];
  onChange: (entries: FormDataEntry[]) => void;
}) {
  const updateEntry = (index: number, patch: Partial<FormDataEntry>) =>
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  return (
    <FormField label="Form-data rows">
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div
            key={`${entry.key}-${index}`}
            className="grid gap-2 rounded-sm border border-border bg-surface-overlay p-2 dark:border-border-dark dark:bg-surface-dark-overlay md:grid-cols-[1fr_1fr_auto_auto]"
          >
            <Input
              value={entry.key}
              onChange={(event) =>
                updateEntry(index, { key: event.target.value })
              }
              placeholder="field"
              className="font-mono"
            />
            <Input
              value={entry.value}
              onChange={(event) =>
                updateEntry(index, { value: event.target.value })
              }
              placeholder="value or file ref"
              className="font-mono"
            />
            <IconSwitch
              checked={entry.type === "file"}
              onCheckedChange={(checked) =>
                updateEntry(index, { type: checked ? "file" : "text" })
              }
              checkedIcon={<File className="h-3 w-3" />}
              uncheckedIcon={<Type className="h-3 w-3" />}
              checkedLabel="File"
              uncheckedLabel="Text"
            />
            <Toggle
              checked={entry.active}
              onChange={(event) =>
                updateEntry(index, { active: event.target.checked })
              }
            />
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([
              ...entries,
              { key: "", value: "", type: "text", active: true },
            ])
          }
        >
          Add row
        </Button>
      </div>
    </FormField>
  );
}
