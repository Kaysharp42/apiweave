import { useEffect, useRef, useState } from "react";
import { FileText, KeyRound, Search, Settings, SlidersHorizontal, Waypoints } from "lucide-react";
import type { GrpcDiscoveryResult } from "@shared/types/GrpcDiscoveryResult";
import { apiweave } from "../../utils/apiweaveClient";
import { Input } from "../atoms/Input";
import { TextArea } from "../atoms/TextArea";
import { Button } from "../atoms/Button";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { KeyValueEditor } from "../molecules/KeyValueEditor";
import { StreamFinishConditionsEditor } from "../molecules/StreamFinishConditionsEditor";
import { TemplateInput, useTemplateAutocomplete } from "../molecules/TemplateAutocomplete";
import ButtonSelect from "../ButtonSelect";
import type { AuthConfig } from "@shared/types/AuthConfig";
import type { GrpcConfigPanelProps, KeyValuePair, NodeModalGrpcConfig, SelectOption } from "../../types";

function createCardIcon(Icon: typeof Waypoints) {
  return function CardIcon({ className }: { className?: string | undefined }) {
    return <Icon className={className} />;
  };
}

const WaypointsCardIcon = createCardIcon(Waypoints);
const FileCardIcon = createCardIcon(FileText);
const KeyCardIcon = createCardIcon(KeyRound);
const SettingsCardIcon = createCardIcon(Settings);
const SlidersHorizontalIcon = createCardIcon(SlidersHorizontal);

const CALL_TYPE_OPTIONS: SelectOption[] = [
  { label: "Unary", value: "unary" },
  { label: "Server streaming", value: "server-streaming" },
];

const SCHEMA_SOURCE_OPTIONS: SelectOption[] = [
  { label: "Server reflection", value: "reflection" },
  { label: "Proto files", value: "proto" },
];

const AUTH_OPTIONS: SelectOption[] = [
  { label: "None", value: "none" },
  { label: "Bearer token", value: "bearer" },
  { label: "API key (metadata)", value: "apiKey" },
];

const EMPTY_MESSAGE = "{}";

function defaultConfig(config: Partial<NodeModalGrpcConfig>): NodeModalGrpcConfig {
  return {
    callType: config.callType ?? "unary",
    target: config.target ?? "",
    tls: config.tls ?? false,
    sslVerify: config.sslVerify ?? true,
    service: config.service ?? "",
    method: config.method ?? "",
    message: config.message ?? EMPTY_MESSAGE,
    metadata: config.metadata ?? [],
    ...(config.auth === undefined ? {} : { auth: config.auth }),
    deadline: config.deadline ?? 30,
    schemaSource: config.schemaSource ?? "reflection",
    protoFiles: config.protoFiles ?? {},
    continueOnFail: config.continueOnFail ?? false,
    ...(config.expectedStatus === undefined ? {} : { expectedStatus: config.expectedStatus }),
    maxMessages: config.maxMessages ?? 1000,
    finishConditions: config.finishConditions ?? [],
    extractors: config.extractors ?? {},
  };
}

function extractorPairs(extractors: Record<string, string>): KeyValuePair[] {
  return Object.entries(extractors).map(([key, value]) => ({ key, value }));
}

function extractorsFromPairs(pairs: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(
    pairs.filter((pair) => pair.active !== false && pair.key.trim() !== "").map((pair) => [pair.key.trim(), pair.value]),
  );
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** An entry of `protoFiles` as an ordered row, so its path can be edited without losing its place. */
interface ProtoFileRow {
  path: string;
  content: string;
}

function toRows(files: Record<string, string>): ProtoFileRow[] {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function fromRows(rows: ProtoFileRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.path.trim() !== "").map((row) => [row.path.trim(), row.content]));
}

export function GrpcConfigPanel({ initialConfig, workingDataRef, activeTab }: GrpcConfigPanelProps) {
  const [config, setConfig] = useState<NodeModalGrpcConfig>(() => defaultConfig(initialConfig));
  const [extractorRows, setExtractorRows] = useState<KeyValuePair[]>(() => extractorPairs(initialConfig.extractors ?? {}));
  const [protoRows, setProtoRows] = useState<ProtoFileRow[]>(() => toRows(initialConfig.protoFiles ?? {}));
  const [discovery, setDiscovery] = useState<GrpcDiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  // The skeleton the message was last filled with: a message still equal to it is safe to replace.
  const generatedSkeleton = useRef<string | null>(null);

  useEffect(() => {
    setConfig(defaultConfig(initialConfig));
    setExtractorRows(extractorPairs(initialConfig.extractors ?? {}));
    setProtoRows(toRows(initialConfig.protoFiles ?? {}));
    setDiscovery(null);
    setDiscoveryError(null);
  }, [initialConfig]);

  const updateConfig = (patch: Partial<NodeModalGrpcConfig>) => {
    const nextConfig = { ...config, ...patch };
    setConfig(nextConfig);
    workingDataRef.current = { ...workingDataRef.current, config: nextConfig };
  };

  const messageAutocomplete = useTemplateAutocomplete<HTMLTextAreaElement>(config.message, (message) => updateConfig({ message }));

  const updateProtoRows = (rows: ProtoFileRow[]) => {
    setProtoRows(rows);
    updateConfig({ protoFiles: fromRows(rows) });
  };

  const discover = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const result = await apiweave.grpc.discover(
        config.schemaSource === "proto"
          ? { schemaSource: "proto", protoFiles: fromRows(protoRows) }
          : { schemaSource: "reflection", target: config.target, tls: config.tls, sslVerify: config.sslVerify },
      );
      setDiscovery(result);
      if (result.services.length === 0) setDiscoveryError("The schema has no services.");
    } catch (error) {
      setDiscovery(null);
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscovering(false);
    }
  };

  const importProtoFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const added = await Promise.all(Array.from(files).map(async (file) => ({ path: file.name, content: await file.text() })));
    const kept = protoRows.filter((row) => !added.some((file) => file.path === row.path));
    updateProtoRows([...kept, ...added]);
  };

  /** The methods the chosen call type can invoke: unary, or server streaming (never client streaming). */
  const callableMethods = (service: string) =>
    discovery?.services
      .find((candidate) => candidate.name === service)
      ?.methods.filter((method) =>
        config.callType === "server-streaming"
          ? method.responseStreaming && !method.requestStreaming
          : !method.requestStreaming && !method.responseStreaming,
      ) ?? [];

  const skeletonOf = (service: string, method: string): string | undefined =>
    discovery?.services.find((candidate) => candidate.name === service)?.methods.find((candidate) => candidate.name === method)?.requestSkeleton;

  const chooseMethod = (service: string, method: string) => {
    const skeleton = skeletonOf(service, method);
    const replaceable = config.message.trim() === "" || config.message.trim() === EMPTY_MESSAGE || config.message === generatedSkeleton.current;
    if (skeleton !== undefined && replaceable) {
      generatedSkeleton.current = skeleton;
      updateConfig({ service, method, message: skeleton });
    } else {
      updateConfig({ service, method });
    }
  };

  const chooseService = (service: string) => {
    const first = callableMethods(service)[0]?.name ?? "";
    chooseMethod(service, first);
  };

  const serviceOptions: SelectOption[] = (discovery?.services ?? []).map((service) => ({ label: service.name, value: service.name }));
  const methodOptions: SelectOption[] = callableMethods(config.service).map((method) => ({ label: method.name, value: method.name }));

  const updateAuth = (auth: AuthConfig) => updateConfig({ auth });
  const authType = config.auth?.type === "bearer" || config.auth?.type === "apiKey" ? config.auth.type : "none";

  if (activeTab === "endpoint") {
    return (
      <div className="space-y-4">
        <Card title="Server" icon={WaypointsCardIcon}>
          <div className="space-y-4">
            <FormField label="Target" hint="host:port. Reflection discovery needs the address written out; a placeholder is only filled in when the call runs.">
              <TemplateInput value={config.target} onValueChange={(target) => updateConfig({ target })} placeholder="localhost:50051" className="font-mono" />
            </FormField>
            <Toggle label="Use TLS (CA and client certificate from Settings > Network)" checked={config.tls} onChange={(event) => updateConfig({ tls: event.target.checked })} />
          </div>
        </Card>
        <Card title="Schema" icon={FileCardIcon}>
          <div className="space-y-4">
            <FormField label="Schema source">
              <ButtonSelect
                options={SCHEMA_SOURCE_OPTIONS}
                value={config.schemaSource}
                onChange={(schemaSource) => {
                  setDiscovery(null);
                  setDiscoveryError(null);
                  updateConfig({ schemaSource: schemaSource === "proto" ? "proto" : "reflection" });
                }}
                buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              />
            </FormField>
            {config.schemaSource === "proto" && (
              <div className="space-y-3">
                {protoRows.map((row, index) => (
                  <div key={index} className="space-y-2 rounded-xs border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
                    <FormField label="Path" hint="What other files import it as, e.g. shop/common.proto.">
                      <Input value={row.path} onChange={(event) => updateProtoRows(protoRows.map((candidate, current) => (current === index ? { ...candidate, path: event.target.value } : candidate)))} className="font-mono" />
                    </FormField>
                    <TextArea
                      aria-label={`Contents of ${row.path || "the proto file"}`}
                      rows={8}
                      value={row.content}
                      onChange={(event) => updateProtoRows(protoRows.map((candidate, current) => (current === index ? { ...candidate, content: event.target.value } : candidate)))}
                      className="resize-y font-mono"
                    />
                    <Button variant="ghost" intent="error" size="xs" onClick={() => updateProtoRows(protoRows.filter((_, current) => current !== index))}>
                      Remove file
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => filePickerRef.current?.click()}>Choose .proto files</Button>
                  <Button variant="secondary" size="sm" onClick={() => updateProtoRows([...protoRows, { path: "", content: "" }])}>Add empty file</Button>
                </div>
                <input
                  ref={filePickerRef}
                  type="file"
                  accept=".proto"
                  multiple
                  hidden
                  aria-label="Proto files"
                  onChange={(event) => {
                    void importProtoFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
            )}
            <Button variant="primary" size="sm" icon={<Search className="h-4 w-4" />} loading={discovering} onClick={() => void discover()}>
              Discover
            </Button>
            {discoveryError !== null && (
              <div role="alert" className="rounded-xs border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{discoveryError}</div>
            )}
          </div>
        </Card>
        <Card title="Method" icon={WaypointsCardIcon}>
          <div className="space-y-4">
            <FormField label="Call type" hint="Server streaming opens a stream: the Ready output fires once the call is accepted, and the Complete output fires when it closes.">
              <ButtonSelect
                options={CALL_TYPE_OPTIONS}
                value={config.callType}
                onChange={(callType) => updateConfig({ callType: callType as NodeModalGrpcConfig["callType"] })}
                buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              />
            </FormField>
            {discovery !== null && discovery.services.length > 0 ? (
              <>
                <FormField label="Service">
                  <ButtonSelect
                    options={serviceOptions}
                    value={config.service}
                    onChange={chooseService}
                    placeholder="Choose a service"
                    buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
                  />
                </FormField>
                <FormField label="Method" hint={config.callType === "server-streaming" ? "Only server-streaming methods are listed." : "Only unary methods are listed."}>
                  <ButtonSelect
                    options={methodOptions}
                    value={config.method}
                    onChange={(method) => chooseMethod(config.service, method)}
                    placeholder="Choose a method"
                    buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
                  />
                </FormField>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Service" hint="Run Discover to pick from a list.">
                  <Input value={config.service} onChange={(event) => updateConfig({ service: event.target.value })} placeholder="helloworld.Greeter" className="font-mono" />
                </FormField>
                <FormField label="Method">
                  <Input value={config.method} onChange={(event) => updateConfig({ method: event.target.value })} placeholder={config.callType === "server-streaming" ? "Watch" : "SayHello"} className="font-mono" />
                </FormField>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (activeTab === "message") {
    const skeleton = skeletonOf(config.service, config.method);
    return (
      <Card title="Request message" icon={FileCardIcon}>
        <FormField label="Message (JSON)" hint="Field names as written in the .proto. Supports variables and secrets; int64 values may be strings, bytes are base64.">
          <TextArea {...messageAutocomplete.props} rows={16} className="h-96 resize-none font-mono" />
          {messageAutocomplete.list}
        </FormField>
        {skeleton !== undefined && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              generatedSkeleton.current = skeleton;
              updateConfig({ message: skeleton });
            }}
          >
            Reset to skeleton
          </Button>
        )}
      </Card>
    );
  }

  if (activeTab === "metadata") {
    return (
      <div className="space-y-4">
        <Card title="Metadata" icon={KeyCardIcon}>
          <FormField label="Metadata" hint="gRPC's headers. Keys are sent in lowercase; a key ending in -bin takes base64.">
            <KeyValueEditor pairs={config.metadata} onChange={(metadata) => updateConfig({ metadata: metadata as KeyValuePair[] })} keyPlaceholder="x-request-id" valuePlaceholder="{{uuid()}}" />
          </FormField>
        </Card>
        <Card title="Auth" icon={KeyCardIcon}>
          <div className="space-y-4">
            <FormField label="Type">
              <ButtonSelect
                options={AUTH_OPTIONS}
                value={authType}
                onChange={(type) => {
                  if (type === "bearer") updateAuth({ type: "bearer", bearer: { token: config.auth?.bearer?.token ?? "" } });
                  else if (type === "apiKey") updateAuth({ type: "apiKey", apiKey: { key: config.auth?.apiKey?.key ?? "", value: config.auth?.apiKey?.value ?? "", addTo: "header" } });
                  else updateConfig({ auth: { type: "none" } });
                }}
                buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              />
            </FormField>
            {authType === "bearer" && (
              <FormField label="Bearer token" hint="Sent as authorization metadata.">
                <TemplateInput value={config.auth?.bearer?.token ?? ""} onValueChange={(token) => updateAuth({ type: "bearer", bearer: { token } })} placeholder="{{secrets.API_TOKEN}}" className="font-mono" />
              </FormField>
            )}
            {authType === "apiKey" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Metadata key">
                  <Input value={config.auth?.apiKey?.key ?? ""} onChange={(event) => updateAuth({ type: "apiKey", apiKey: { key: event.target.value, value: config.auth?.apiKey?.value ?? "", addTo: "header" } })} placeholder="x-api-key" className="font-mono" />
                </FormField>
                <FormField label="Value">
                  <TemplateInput value={config.auth?.apiKey?.value ?? ""} onValueChange={(value) => updateAuth({ type: "apiKey", apiKey: { key: config.auth?.apiKey?.key ?? "", value, addTo: "header" } })} placeholder="{{secrets.API_KEY}}" className="font-mono" />
                </FormField>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (activeTab === "finish") {
    return (
      <Card title="Finish trigger" icon={SlidersHorizontalIcon}>
        <div className="space-y-4">
          {config.callType !== "server-streaming" && (
            <div className="rounded-xs border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-(--aw-status-info)/30 dark:bg-(--aw-status-info)/10 dark:text-(--aw-status-info)">
              Finish rules close a server-streaming call. A unary call ends on its own, so these rules are unused.
            </div>
          )}
          <StreamFinishConditionsEditor
            conditions={config.finishConditions}
            onChange={(finishConditions) => updateConfig({ finishConditions })}
            hint={<>The call closes when every rule matches the same response. Paths read the decoded message, for example <code className="font-mono">status</code> or a JSONPath such as <code className="font-mono">$.items[0].done</code>.</>}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Call settings" icon={SettingsCardIcon}>
      <div className="space-y-4">
        <FormField label="Deadline (seconds)" {...(config.callType === "server-streaming" ? { hint: "Bounds the whole call, so it is also the listener's timeout." } : {})}>
          <Input type="number" min={1} max={3600} value={config.deadline} onChange={(event) => updateConfig({ deadline: positiveInteger(event.target.value, config.deadline) })} className="max-w-40 font-mono" />
        </FormField>
        {config.callType === "server-streaming" && (
          <FormField label="Max responses" hint="The most responses retained. Without finish rules, reaching this limit closes the call.">
            <Input type="number" min={1} max={1000} value={config.maxMessages} onChange={(event) => updateConfig({ maxMessages: positiveInteger(event.target.value, config.maxMessages) })} className="max-w-40 font-mono" />
          </FormField>
        )}
        <FormField label="Expected status" hint="A gRPC code name such as NOT_FOUND. Empty expects OK; any other status fails the node.">
          <Input
            value={config.expectedStatus ?? ""}
            onChange={(event) => {
              const nextConfig = { ...config };
              if (event.target.value) nextConfig.expectedStatus = event.target.value.toUpperCase();
              else delete nextConfig.expectedStatus;
              setConfig(nextConfig);
              workingDataRef.current = { ...workingDataRef.current, config: nextConfig };
            }}
            placeholder="OK"
            className="max-w-60 font-mono"
          />
        </FormField>
        <Toggle label="Verify TLS certificates" checked={config.sslVerify} onChange={(event) => updateConfig({ sslVerify: event.target.checked })} />
        <Toggle label="Continue if the call fails" checked={config.continueOnFail} onChange={(event) => updateConfig({ continueOnFail: event.target.checked })} />
        <FormField label="Extract variables" hint="Map a variable name to a path such as response.body.id or response.trailers.x-id.">
          <KeyValueEditor
            pairs={extractorRows}
            onChange={(pairs) => {
              setExtractorRows(pairs);
              updateConfig({ extractors: extractorsFromPairs(pairs) });
            }}
            keyPlaceholder="orderId"
            valuePlaceholder="response.body.order_id"
          />
        </FormField>
      </div>
    </Card>
  );
}
