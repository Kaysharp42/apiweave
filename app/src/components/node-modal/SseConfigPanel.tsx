import { useEffect, useState } from "react";
import { Cable, Settings, SlidersHorizontal } from "lucide-react";
import { Input } from "../atoms/Input";
import { Button } from "../atoms/Button";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { KeyValueEditor } from "../molecules/KeyValueEditor";
import ButtonSelect from "../ButtonSelect";
import type { KeyValuePair, NodeModalSseConfig, SseConfigPanelProps, SelectOption } from "../../types";
import type { SseFinishCondition } from "@shared/types/SseFinishCondition";

function createCardIcon(Icon: typeof Cable) {
  return function CardIcon({ className }: { className?: string | undefined }) {
    return <Icon className={className} />;
  };
}

const CableCardIcon = createCardIcon(Cable);
const SettingsCardIcon = createCardIcon(Settings);
const SlidersCardIcon = createCardIcon(SlidersHorizontal);

function defaultConfig(config: Partial<NodeModalSseConfig>): NodeModalSseConfig {
  return {
    url: config.url ?? "",
    queryParams: config.queryParams ?? [],
    headers: config.headers ?? [],
    ...(config.auth === undefined ? {} : { auth: config.auth }),
    timeout: config.timeout ?? 30,
    followRedirects: config.followRedirects ?? true,
    sslVerify: config.sslVerify ?? true,
    ...(config.eventType === undefined ? {} : { eventType: config.eventType }),
    maxEvents: config.maxEvents ?? 1,
    finishConditions: config.finishConditions ?? [],
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

const FINISH_OPERATOR_OPTIONS: SelectOption[] = [
  "equals", "notEquals", "contains", "notContains", "gt", "gte", "lt", "lte", "count", "exists", "notExists",
].map((operator) => ({ label: operator, value: operator }));

function emptyFinishCondition(): SseFinishCondition {
  return { path: "data.status", operator: "equals", expectedValue: "" };
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

export function SseConfigPanel({ initialConfig, workingDataRef, activeTab }: SseConfigPanelProps) {
  const [config, setConfig] = useState<NodeModalSseConfig>(() => defaultConfig(initialConfig));

  useEffect(() => {
    setConfig(defaultConfig(initialConfig));
  }, [initialConfig]);

  const updateConfig = (patch: Partial<NodeModalSseConfig>) => {
    const nextConfig = { ...config, ...patch };
    setConfig(nextConfig);
    workingDataRef.current = { ...workingDataRef.current, config: nextConfig };
  };

  const updateEventType = (value: string) => {
    const nextConfig = { ...config };
    if (value) nextConfig.eventType = value;
    else delete nextConfig.eventType;
    setConfig(nextConfig);
    workingDataRef.current = { ...workingDataRef.current, config: nextConfig };
  };

  if (activeTab === "endpoint") {
    return (
      <div className="space-y-4">
        <Card title="Stream endpoint" icon={CableCardIcon}>
          <div className="space-y-4">
            <FormField label="SSE URL" hint="Uses GET with Accept: text/event-stream. Supports variables and secrets.">
              <Input value={config.url} onChange={(event) => updateConfig({ url: event.target.value })} placeholder="{{env.BASE_URL}}/events" className="font-mono" />
            </FormField>
            <FormField label="Event type" hint="Optional exact filter for the SSE event field. Other events are ignored.">
              <Input value={config.eventType ?? ""} onChange={(event) => updateEventType(event.target.value)} placeholder="order.updated" className="font-mono" />
            </FormField>
            <FormField label="Events to collect" hint="The connection closes as soon as this many matching events arrive.">
              <Input type="number" min="1" max="100" value={config.maxEvents} onChange={(event) => updateConfig({ maxEvents: positiveInteger(event.target.value, config.maxEvents) })} className="max-w-40 font-mono" />
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
      <Card title="Request headers" icon={SlidersCardIcon}>
        <FormField label="Headers" hint="Use Authorization and {{secrets.NAME}} references for authenticated streams.">
          <KeyValueEditor pairs={config.headers} onChange={(headers) => updateConfig({ headers: headers as KeyValuePair[] })} keyPlaceholder="Authorization" valuePlaceholder="Bearer {{secrets.API_TOKEN}}" />
        </FormField>
      </Card>
    );
  }

  if (activeTab === "finish") {
    const updateCondition = (index: number, patch: Partial<SseFinishCondition>) => {
      updateConfig({ finishConditions: config.finishConditions.map((condition, currentIndex) => currentIndex === index ? { ...condition, ...patch } : condition) });
    };
    const removeCondition = (index: number) => {
      updateConfig({ finishConditions: config.finishConditions.filter((_, currentIndex) => currentIndex !== index) });
    };
    return (
      <Card title="Finish trigger" icon={SettingsCardIcon}>
        <div className="space-y-4">
          <div className="rounded-sm border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]">
            The listener closes when every rule matches the same event. Use <code className="font-mono">data.status</code> for JSON event data, or <code className="font-mono">data</code>, <code className="font-mono">event</code>, and <code className="font-mono">id</code> for event fields.
          </div>
          {config.finishConditions.map((condition, index) => (
            <div key={`${condition.path}-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Event path">
                  <Input value={condition.path} onChange={(event) => updateCondition(index, { path: event.target.value })} placeholder="data.status" className="font-mono" />
                </FormField>
                <FormField label="Operator">
                  <ButtonSelect options={FINISH_OPERATOR_OPTIONS} value={condition.operator} onChange={(operator) => updateCondition(index, { operator: operator as SseFinishCondition["operator"] })} buttonClass="flex h-10 w-full items-center justify-between rounded-sm border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark" />
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
          <Input type="number" min="0" max="300" value={config.timeout} onChange={(event) => updateConfig({ timeout: nonNegativeInteger(event.target.value, config.timeout) })} className="max-w-40 font-mono" />
        </FormField>
        <Toggle label="Follow redirects" checked={config.followRedirects} onChange={(event) => updateConfig({ followRedirects: event.target.checked })} />
        <Toggle label="Verify TLS certificates" checked={config.sslVerify} onChange={(event) => updateConfig({ sslVerify: event.target.checked })} />
        <Toggle label="Continue if stream test fails" checked={config.continueOnFail} onChange={(event) => updateConfig({ continueOnFail: event.target.checked })} />
        <FormField label="Extract variables" hint="Map a variable name to a path such as response.body.events[0].data.">
          <KeyValueEditor
            pairs={extractorPairs(config.extractors)}
            onChange={(pairs) => updateConfig({ extractors: extractorsFromPairs(pairs) })}
            keyPlaceholder="eventPayload"
            valuePlaceholder="response.body.events[0].data"
          />
        </FormField>
      </div>
    </Card>
  );
}
