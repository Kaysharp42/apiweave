import { useEffect, useState } from "react";
import { Cable, MessageSquare, Settings, SlidersHorizontal } from "lucide-react";
import { Input } from "../atoms/Input";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { Button } from "../atoms/Button";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { KeyValueEditor } from "../molecules/KeyValueEditor";
import ButtonSelect from "../ButtonSelect";
import { AssertionOperatorSchema } from "@shared/zod-schemas/AssertionOperatorSchema";
import type { KeyValuePair, NodeModalWebsocketConfig, SelectOption, WebsocketConfigPanelProps } from "../../types";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

function createCardIcon(Icon: typeof Cable) {
  return function CardIcon({ className }: { className?: string | undefined }) {
    return <Icon className={className} />;
  };
}

const CableCardIcon = createCardIcon(Cable);
const SettingsCardIcon = createCardIcon(Settings);
const SlidersCardIcon = createCardIcon(SlidersHorizontal);
const MessageCardIcon = createCardIcon(MessageSquare);

type WebsocketMessage = NodeModalWebsocketConfig["messages"][number];

// fallow-ignore-next-line complexity -- each fallback is an independent persisted WebSocket setting; a generic defaults layer would hide the panel's complete configuration shape.
function defaultConfig(config: Partial<NodeModalWebsocketConfig>): NodeModalWebsocketConfig {
  return {
    url: config.url ?? "",
    queryParams: config.queryParams ?? [],
    headers: config.headers ?? [],
    ...(config.auth === undefined ? {} : { auth: config.auth }),
    subprotocols: config.subprotocols ?? [],
    messages: config.messages ?? [],
    timeout: config.timeout ?? 30,
    maxMessages: config.maxMessages ?? 1,
    finishConditions: config.finishConditions ?? [],
    sslVerify: config.sslVerify ?? true,
    continueOnFail: config.continueOnFail ?? false,
    extractors: config.extractors ?? {},
  };
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function numberInput(min: number, max: number, value: number, onChange: (value: string) => void) {
  return <Input type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} className="max-w-40 font-mono" />;
}

const FINISH_OPERATOR_OPTIONS: SelectOption[] = AssertionOperatorSchema.options.map(
  (operator) => ({ label: operator, value: operator }),
);

const MESSAGE_TYPE_OPTIONS: SelectOption[] = [
  { label: "text", value: "text" },
  { label: "binary", value: "binary" },
];

function emptyFinishCondition(): StreamFinishCondition {
  return { path: "data.status", operator: "equals", expectedValue: "" };
}

function emptyMessage(): WebsocketMessage {
  return { data: "", type: "text" };
}

function extractorPairs(extractors: Record<string, string>): KeyValuePair[] {
  return Object.entries(extractors).map(([key, value]) => ({ key, value }));
}

function extractorsFromPairs(pairs: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(
    pairs
      .filter((pair) => pair.active !== false && pair.key.trim() !== "")
      .map((pair) => [pair.key.trim(), pair.value]),
  );
}

export function WebsocketConfigPanel({ initialConfig, workingDataRef, activeTab }: WebsocketConfigPanelProps) {
  const [config, setConfig] = useState<NodeModalWebsocketConfig>(() => defaultConfig(initialConfig));
  const [extractorRows, setExtractorRows] = useState<KeyValuePair[]>(() =>
    extractorPairs(initialConfig.extractors ?? {}),
  );

  useEffect(() => {
    setConfig(defaultConfig(initialConfig));
    setExtractorRows(extractorPairs(initialConfig.extractors ?? {}));
  }, [initialConfig]);

  const updateConfig = (patch: Partial<NodeModalWebsocketConfig>) => {
    const nextConfig = { ...config, ...patch };
    setConfig(nextConfig);
    workingDataRef.current = { ...workingDataRef.current, config: nextConfig };
  };

  if (activeTab === "endpoint") {
    return (
      <div className="space-y-4">
        <Card title="WebSocket endpoint" icon={CableCardIcon}>
          <div className="space-y-4">
            <FormField label="WebSocket URL" hint="ws:// or wss://. Supports variables and secrets.">
              <TemplateInput value={config.url} onValueChange={(url) => updateConfig({ url })} placeholder="wss://{{env.HOST}}/socket" className="font-mono" />
            </FormField>
            <FormField label="Subprotocols" hint="Optional, comma-separated. Each is requested in the handshake.">
              <Input
                value={config.subprotocols.join(", ")}
                onChange={(event) => updateConfig({ subprotocols: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
                placeholder="graphql-transport-ws"
                className="font-mono"
              />
            </FormField>
          </div>
        </Card>
        <Card title="Query parameters" icon={SlidersCardIcon}>
          <KeyValueEditor pairs={config.queryParams} onChange={(queryParams) => updateConfig({ queryParams: queryParams as KeyValuePair[] })} keyPlaceholder="topic" valuePlaceholder="orders" />
        </Card>
      </div>
    );
  }

  if (activeTab === "headers") {
    return (
      <Card title="Handshake headers" icon={SlidersCardIcon}>
        <FormField label="Headers" hint="Use Authorization and {{secrets.NAME}} references for authenticated sockets.">
          <KeyValueEditor pairs={config.headers} onChange={(headers) => updateConfig({ headers: headers as KeyValuePair[] })} keyPlaceholder="Authorization" valuePlaceholder="Bearer {{secrets.API_TOKEN}}" />
        </FormField>
      </Card>
    );
  }

  if (activeTab === "messages") {
    const updateMessage = (index: number, patch: Partial<WebsocketMessage>) => {
      updateConfig({ messages: config.messages.map((message, currentIndex) => currentIndex === index ? { ...message, ...patch } : message) });
    };
    const removeMessage = (index: number) => {
      updateConfig({ messages: config.messages.filter((_, currentIndex) => currentIndex !== index) });
    };
    return (
      <Card title="Outbound messages" icon={MessageCardIcon}>
        <div className="space-y-4">
          <div className="rounded-xs border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-(--aw-status-info)/30 dark:bg-(--aw-status-info)/10 dark:text-(--aw-status-info)">
            Messages are sent in order once the connection is open. A binary message sends the base64 <code className="font-mono">data</code>.
          </div>
          {config.messages.map((message, index) => (
            <div key={index} className="space-y-3 rounded-xs border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
              <FormField label="Data">
                <TemplateInput value={message.data} onValueChange={(data) => updateMessage(index, { data })} placeholder='{"action":"subscribe"}' className="font-mono" />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Type">
                  <ButtonSelect options={MESSAGE_TYPE_OPTIONS} value={message.type} onChange={(type) => updateMessage(index, { type: type as "text" | "binary" })} buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark" />
                </FormField>
                <FormField label="Delay before send (ms)" hint="Optional.">
                  <Input
                    type="number"
                    min={0}
                    max={300000}
                    value={message.delayMs ?? ""}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      const { delayMs: _previous, ...rest } = message;
                      updateConfig({
                        messages: config.messages.map((current, currentIndex) =>
                          currentIndex !== index ? current : Number.isInteger(parsed) && parsed >= 0 ? { ...rest, delayMs: parsed } : rest),
                      });
                    }}
                    placeholder="0"
                    className="max-w-40 font-mono"
                  />
                </FormField>
              </div>
              <Button variant="ghost" intent="error" size="xs" onClick={() => removeMessage(index)}>Remove message</Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => updateConfig({ messages: [...config.messages, emptyMessage()] })}>Add message</Button>
        </div>
      </Card>
    );
  }

  if (activeTab === "finish") {
    const updateCondition = (index: number, patch: Partial<StreamFinishCondition>) => {
      updateConfig({ finishConditions: config.finishConditions.map((condition, currentIndex) => currentIndex === index ? { ...condition, ...patch } : condition) });
    };
    const removeCondition = (index: number) => {
      updateConfig({ finishConditions: config.finishConditions.filter((_, currentIndex) => currentIndex !== index) });
    };
    return (
      <Card title="Finish trigger" icon={SettingsCardIcon}>
        <div className="space-y-4">
          <div className="rounded-xs border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-(--aw-status-info)/30 dark:bg-(--aw-status-info)/10 dark:text-(--aw-status-info)">
            The connection closes when every rule matches the same message. Use <code className="font-mono">data.status</code> for JSON message data, or <code className="font-mono">data</code> and <code className="font-mono">type</code> for the raw message.
          </div>
          {config.finishConditions.map((condition, index) => (
            <div key={index} className="space-y-3 rounded-xs border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Message path">
                  <Input value={condition.path} onChange={(event) => updateCondition(index, { path: event.target.value })} placeholder="data.status" className="font-mono" />
                </FormField>
                <FormField label="Operator">
                  <ButtonSelect options={FINISH_OPERATOR_OPTIONS} value={condition.operator} onChange={(operator) => updateCondition(index, { operator: operator as StreamFinishCondition["operator"] })} buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark" />
                </FormField>
              </div>
              {condition.operator !== "exists" && condition.operator !== "notExists" && (
                <FormField label="Expected value">
                  <Input value={typeof condition.expectedValue === "string" ? condition.expectedValue : String(condition.expectedValue ?? "")} onChange={(event) => updateCondition(index, { expectedValue: event.target.value })} placeholder="completed" className="font-mono" />
                </FormField>
              )}
              <Button variant="ghost" intent="error" size="xs" onClick={() => removeCondition(index)}>Remove rule</Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => updateConfig({ finishConditions: [...config.finishConditions, emptyFinishCondition()] })}>Add finish rule</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Stream limits" icon={SettingsCardIcon}>
      <div className="space-y-4">
        <FormField label="Timeout (seconds)" hint="Set to 0 to wait until a finish trigger matches. A finish rule is required when timeout is 0.">
          {numberInput(0, 300, config.timeout, (value) => updateConfig({ timeout: nonNegativeInteger(value, config.timeout) }))}
        </FormField>
        <FormField label="Messages to collect" hint="The connection closes as soon as this many incoming messages arrive.">
          {numberInput(1, 100, config.maxMessages, (value) => updateConfig({ maxMessages: positiveInteger(value, config.maxMessages) }))}
        </FormField>
        <Toggle label="Verify TLS certificates" checked={config.sslVerify} onChange={(event) => updateConfig({ sslVerify: event.target.checked })} />
        <Toggle label="Continue if socket test fails" checked={config.continueOnFail} onChange={(event) => updateConfig({ continueOnFail: event.target.checked })} />
        <FormField label="Extract variables" hint="Map a variable name to a path such as response.body.messages[0].data.">
          <KeyValueEditor
            pairs={extractorRows}
            onChange={(pairs) => {
              setExtractorRows(pairs);
              updateConfig({ extractors: extractorsFromPairs(pairs) });
            }}
            keyPlaceholder="messagePayload"
            valuePlaceholder="response.body.messages[0].data"
          />
        </FormField>
      </div>
    </Card>
  );
}
