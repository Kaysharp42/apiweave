import { Suspense } from "react";
import { Input } from "../atoms/Input";
import { Toggle } from "../atoms/Toggle";
import { FormField } from "../molecules/FormField";
import { registerTemplateCompletion } from "../../utils/monacoTemplateCompletion";
import { MonacoEditor } from "./lazyMonaco";
import type { JsonrpcBody, JsonrpcBodyEditorProps } from "../../types";

/**
 * Why `text` is not a JSON value template (object or array), or undefined
 * (empty is fine). Placeholders stand in for a value, so they are filled with
 * one before parsing.
 */
function jsonValueTemplateProblem(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.replace(/\{\{[^}]+\}\}/g, "0"));
    return parsed !== null && typeof parsed === "object"
      ? undefined
      : "Must be a JSON object or array";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
}

/** A JSON-RPC 2.0 request: the method, its params as JSON, and a notification flag. */
export function JsonrpcBodyEditor({
  jsonrpc,
  isDarkMode,
  allowRpcError,
  onChange,
  onAllowRpcErrorChange,
}: JsonrpcBodyEditorProps) {
  const current: JsonrpcBody = jsonrpc ?? { method: "" };
  const paramsProblem = jsonValueTemplateProblem(current.params ?? "");
  const update = (patch: Partial<JsonrpcBody>) =>
    onChange({ ...current, ...patch });
  return (
    <div className="space-y-4">
      <FormField
        label="Method"
        hint='The JSON-RPC method to invoke, e.g. "subtract" or "eth_blockNumber". Placeholders are substituted.'
      >
        <Input
          value={current.method}
          onChange={(event) => update({ method: event.target.value })}
          className="font-mono"
          placeholder="eth_blockNumber"
        />
      </FormField>
      <FormField
        label="Params"
        hint='A JSON object (by name) or array (by position). A placeholder standing alone, as in "id": {{variables.userId}}, is inserted as a value. Leave empty for a method that takes none.'
        {...(paramsProblem ? { error: paramsProblem } : {})}
      >        <div className="overflow-hidden rounded-xs border border-border dark:border-border-dark">
          <Suspense
            fallback={
              <div
                style={{ height: 200 }}
                className="flex items-center justify-center text-sm text-text-secondary dark:text-text-secondary-dark"
              >
                Loading editor…
              </div>
            }
          >
            <MonacoEditor
              height="200px"
              language="json"
              theme={isDarkMode ? "vs-dark" : "light"}
              value={current.params ?? ""}
              onChange={(next) => update({ params: next ?? "" })}
              beforeMount={registerTemplateCompletion}
              options={{
                minimap: { enabled: false },
                fontFamily: "JetBrains Mono",
                scrollBeyondLastLine: false,
                tabSize: 2,
                quickSuggestions: { other: true, comments: false, strings: true },
                fixedOverflowWidgets: true,
                editContext: false,
                ariaLabel: "Params",
              }}
            />
          </Suspense>
        </div>
      </FormField>
      <FormField
        label="Notification"
        hint="A notification omits the id member, and the server sends no response. Turn this on for fire-and-forget calls."
      >
        <Toggle
          label="Send as a notification"
          checked={current.notification ?? false}
          onChange={(event) => update({ notification: event.target.checked })}
        />
      </FormField>
      <FormField
        label="Allow error responses"
        hint="By default a JSON-RPC response carrying an error member fails the node. Turn this on to let it pass, then assert response.body.error.code and response.body.error.message."
      >
        <Toggle
          label="Don't fail on a JSON-RPC error"
          checked={allowRpcError}
          onChange={(event) => onAllowRpcErrorChange(event.target.checked)}
        />
      </FormField>
    </div>
  );
}
