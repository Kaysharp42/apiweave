import { useEffect, useState } from "react";
import { Crosshair, Globe, Settings } from "lucide-react";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { BrowserLocatorEditor } from "../molecules/BrowserLocatorEditor";
import { MissingSecretNotice } from "../molecules/MissingSecretNotice";
import { secretNameOf } from "./SecretNameField";
import { BROWSER_ACTIONS } from "@shared/browser/browser_action_labels";
import {
  actionNeedsLocator,
  configFromDraft,
  draftFromConfig,
  extractNeedsLocator,
} from "../../utils/browserStep";
import type { BrowserConfigPanelProps, BrowserStepDraft } from "../../types";

function createCardIcon(Icon: typeof Globe) {
  return function CardIcon({ className }: { className?: string | undefined }) {
    return <Icon className={className} />;
  };
}

const GlobeCardIcon = createCardIcon(Globe);
const CrosshairCardIcon = createCardIcon(Crosshair);
const SettingsCardIcon = createCardIcon(Settings);

const MATCH_OPTIONS: readonly { readonly value: BrowserStepDraft["match"]; readonly label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "is exactly" },
  { value: "matches", label: "matches the regular expression" },
];

const EXTRACT_SOURCES: readonly { readonly value: BrowserStepDraft["from"]; readonly label: string }[] = [
  { value: "text", label: "the element's text" },
  { value: "value", label: "a field's value" },
  { value: "attribute", label: "an attribute of the element" },
  { value: "url", label: "the page address" },
  { value: "title", label: "the page title" },
];

function MatchSelect({ value, onChange }: { value: BrowserStepDraft["match"]; onChange: (match: BrowserStepDraft["match"]) => void }) {
  return (
    <Select value={value} onChange={(event) => {
      const next = MATCH_OPTIONS.find((option) => option.value === event.target.value);
      if (next) onChange(next.value);
    }}>
      {MATCH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  );
}

function DialogSelect({ value, onChange }: { value: BrowserStepDraft["dialog"]; onChange: (dialog: BrowserStepDraft["dialog"]) => void }) {
  return (
    <FormField label="If the page asks for confirmation" hint="A JavaScript alert, confirm() or prompt() this step opens. Left alone, it is cancelled.">
      <Select value={value} onChange={(event) => {
        const dialog = event.target.value;
        onChange(dialog === "accept" || dialog === "dismiss" ? dialog : "");
      }}>
        <option value="">Cancel it (default)</option>
        <option value="accept">Click OK</option>
        <option value="dismiss">Click Cancel</option>
      </Select>
    </FormField>
  );
}

/** The action's own fields, other than the element it acts on. */
// fallow-ignore-next-line complexity -- one branch per browser action: the panel is the action table
function ActionFields({ draft, update }: { draft: BrowserStepDraft; update: (patch: Partial<BrowserStepDraft>) => void }) {
  switch (draft.action) {
    case "navigate":
      return (
        <FormField label="Page address" hint="Usually starts with an environment variable, such as {{env.BASE_URL}}/login.">
          <TemplateInput value={draft.url} onValueChange={(url) => update({ url })} placeholder="{{env.BASE_URL}}/login" className="font-mono" />
        </FormField>
      );
    case "fill":
      return (
        <FormField label="Text to type" hint="Replaces what the field holds. For a password, use a secret: {{secrets.NAME}}. Never type it here.">
          <TemplateInput value={draft.value} onValueChange={(value) => update({ value })} placeholder="{{env.TEST_EMAIL}}" />
          {secretNameOf(draft.value) !== "" && <MissingSecretNotice name={secretNameOf(draft.value)} />}
        </FormField>
      );
    case "click":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle label="Double-click" checked={draft.clickCount === 2} onChange={(event) => update({ clickCount: event.target.checked ? 2 : 1 })} />
          <Toggle label="Right-click" checked={draft.button === "right"} onChange={(event) => update({ button: event.target.checked ? "right" : "left" })} />
          <div className="md:col-span-2">
            <DialogSelect value={draft.dialog} onChange={(dialog) => update({ dialog })} />
          </div>
        </div>
      );
    case "press":
      return (
        <div className="space-y-4">
          <FormField label="Key" hint="A key name such as Enter, Tab, Escape or ArrowDown, or a combination such as Control+A.">
            <Input value={draft.key} onChange={(event) => update({ key: event.target.value })} className="max-w-60 font-mono" />
          </FormField>
          <Toggle label="Press it on a specific element (otherwise on whatever has focus)" checked={draft.pressOnElement} onChange={(event) => update({ pressOnElement: event.target.checked })} />
          <DialogSelect value={draft.dialog} onChange={(dialog) => update({ dialog })} />
        </div>
      );
    case "select":
      return (
        <FormField label="Option to choose" hint="The option's visible text or its value. Separate several with commas for a multi-select.">
          <TemplateInput value={draft.values.join(", ")} onValueChange={(value) => update({ values: value.split(",").map((part) => part.trim()) })} placeholder="Pro" />
        </FormField>
      );
    case "expect-visible":
      return <Toggle label="Expect it to be hidden instead" checked={!draft.visible} onChange={(event) => update({ visible: !event.target.checked })} />;
    case "expect-text":
      return (
        <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
          <FormField label="The text"><MatchSelect value={draft.match} onChange={(match) => update({ match })} /></FormField>
          <FormField label="Expected text" hint="Spaces and line breaks are compared loosely.">
            <TemplateInput value={draft.text} onValueChange={(text) => update({ text })} placeholder="Welcome" />
          </FormField>
        </div>
      );
    case "expect-value":
      return (
        <FormField label="Expected value" hint="What the field holds, compared exactly.">
          <TemplateInput value={draft.value} onValueChange={(value) => update({ value })} />
        </FormField>
      );
    case "expect-url":
      return (
        <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
          <FormField label="The address"><MatchSelect value={draft.match} onChange={(match) => update({ match })} /></FormField>
          <FormField label="Expected address">
            <TemplateInput value={draft.url} onValueChange={(url) => update({ url })} placeholder="/dashboard" className="font-mono" />
          </FormField>
        </div>
      );
    case "extract":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Read">
            <Select value={draft.from} onChange={(event) => {
              const from = EXTRACT_SOURCES.find((source) => source.value === event.target.value);
              if (from) update({ from: from.value });
            }}>
              {EXTRACT_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Into the variable" hint="Later steps read it as {{variables.NAME}}.">
            <Input value={draft.variable} onChange={(event) => update({ variable: event.target.value })} placeholder="orderId" className="font-mono" />
          </FormField>
          {draft.from === "attribute" ? (
            <FormField label="Attribute" className="md:col-span-2">
              <Input value={draft.attribute} onChange={(event) => update({ attribute: event.target.value })} placeholder="href" className="max-w-60 font-mono" />
            </FormField>
          ) : null}
        </div>
      );
    case "check":
    case "uncheck":
    case "hover":
      return null;
  }
}

function needsLocator(draft: BrowserStepDraft): boolean {
  if (draft.action === "press") return draft.pressOnElement;
  if (draft.action === "extract") return extractNeedsLocator(draft.from);
  return actionNeedsLocator(draft.action);
}

/** One browser step: what it does, the element it acts on, and how long it may wait. */
export function BrowserConfigPanel({ initialConfig, workingDataRef, activeTab }: BrowserConfigPanelProps) {
  const [draft, setDraft] = useState<BrowserStepDraft>(() => draftFromConfig(initialConfig));

  useEffect(() => {
    setDraft(draftFromConfig(initialConfig));
  }, [initialConfig]);

  const update = (patch: Partial<BrowserStepDraft>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    workingDataRef.current = { ...workingDataRef.current, config: configFromDraft(next) };
  };

  if (activeTab === "settings") {
    return (
      <Card title="Step settings" icon={SettingsCardIcon}>
        <div className="space-y-4">
          <FormField label="Wait up to (milliseconds)" hint="How long the step waits for the element or the check before failing. Empty: 10000, or 30000 to open a page.">
            <Input
              type="number"
              min={100}
              max={300000}
              value={draft.timeoutMs ?? ""}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                update({ timeoutMs: Number.isInteger(parsed) && parsed >= 100 ? Math.min(parsed, 300_000) : null });
              }}
              placeholder={draft.action === "navigate" ? "30000" : "10000"}
              className="max-w-40 font-mono"
            />
          </FormField>
          <FormField label="Description" hint="A note for whoever reads the workflow.">
            <Input value={draft.description} onChange={(event) => update({ description: event.target.value })} maxLength={500} />
          </FormField>
          <Toggle label="Continue the run if this step fails" checked={draft.continueOnFail} onChange={(event) => update({ continueOnFail: event.target.checked })} />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Step" icon={GlobeCardIcon}>
        <div className="space-y-4">
          <FormField label="What this step does">
            <Select value={draft.action} onChange={(event) => {
              const action = BROWSER_ACTIONS.find((entry) => entry.value === event.target.value);
              if (action) update({ action: action.value });
            }}>
              {BROWSER_ACTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </Select>
          </FormField>
          <ActionFields draft={draft} update={update} />
        </div>
      </Card>
      {needsLocator(draft) ? (
        <Card title="Element" icon={CrosshairCardIcon}>
          <BrowserLocatorEditor locator={draft.locator} onChange={(locator) => update({ locator })} />
        </Card>
      ) : null}
    </div>
  );
}
