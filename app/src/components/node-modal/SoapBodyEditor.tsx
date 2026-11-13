import { Suspense } from "react";
import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";
import { registerTemplateCompletion } from "../../utils/monacoTemplateCompletion";
import { MonacoEditor } from "./lazyMonaco";
import ButtonSelect from "../ButtonSelect";
import type { SoapBody, SoapBodyEditorProps, SelectOption } from "../../types";

const VERSION_OPTIONS: SelectOption[] = [
  { label: "SOAP 1.1", value: "1.1" },
  { label: "SOAP 1.2", value: "1.2" },
];

/**
 * A SOAP request: the complete envelope as XML, plus the version and action
 * that decide the Content-Type and SOAPAction header it is sent with.
 */
export function SoapBodyEditor({ soap, isDarkMode, onChange }: SoapBodyEditorProps) {
  const current: SoapBody = soap ?? { envelope: "" };
  const update = (patch: Partial<SoapBody>) => onChange({ ...current, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="SOAP version"
          hint="1.1 sends text/xml with a SOAPAction header; 1.2 sends application/soap+xml with the action in the Content-Type."
        >
          <ButtonSelect
            options={VERSION_OPTIONS}
            value={current.version ?? "1.1"}
            onChange={(version) => update({ version: version as "1.1" | "1.2" })}
            buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
          />
        </FormField>
        <FormField label="Action" hint="The operation's SOAP action. A SOAP 1.2 envelope usually needs one.">
          <Input
            value={current.action ?? ""}
            onChange={(event) => update({ action: event.target.value })}
            placeholder="urn:example:GetOrder"
            className="font-mono"
          />
        </FormField>
      </div>
      <FormField
        label="Envelope"
        hint="The complete SOAP envelope, sent as-is. Placeholders are substituted. A SOAP Fault fails the node unless the expected status allows it."
      >
        <div className="overflow-hidden rounded-xs border border-border dark:border-border-dark">
          <Suspense
            fallback={
              <div style={{ height: 320 }} className="flex items-center justify-center text-sm text-text-secondary dark:text-text-secondary-dark">
                Loading editor…
              </div>
            }
          >
            <MonacoEditor
              height="320px"
              language="xml"
              theme={isDarkMode ? "vs-dark" : "light"}
              value={current.envelope}
              onChange={(next) => update({ envelope: next ?? "" })}
              beforeMount={registerTemplateCompletion}
              options={{
                minimap: { enabled: false },
                fontFamily: "JetBrains Mono",
                scrollBeyondLastLine: false,
                tabSize: 2,
                quickSuggestions: { other: true, comments: false, strings: true },
                fixedOverflowWidgets: true,
                // See JsonBodyEditor: the EditContext input path drops keystrokes in this Electron build.
                editContext: false,
                ariaLabel: "SOAP envelope",
              }}
            />
          </Suspense>
        </div>
      </FormField>
    </div>
  );
}
