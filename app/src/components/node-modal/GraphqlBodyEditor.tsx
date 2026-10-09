import { Suspense } from "react";
import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";
import { registerTemplateCompletion } from "../../utils/monacoTemplateCompletion";
import { jsonObjectTemplateProblem } from "../../utils/jsonObjectTemplateProblem";
import { MonacoEditor } from "./lazyMonaco";
import type { GraphqlBody, GraphqlBodyEditorProps } from "../../types";

function CodeField({
  label,
  hint,
  error,
  language,
  height,
  value,
  isDarkMode,
  onChange,
}: {
  label: string;
  hint: string;
  error?: string | undefined;
  language: "graphql" | "json";
  height: number;
  value: string;
  isDarkMode: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} hint={hint} {...(error ? { error } : {})}>
      <div
        className={[
          "overflow-hidden rounded-sm border",
          error
            ? "border-status-error dark:border-[var(--aw-status-error)]"
            : "border-border dark:border-border-dark",
        ].join(" ")}
      >
        <Suspense
          fallback={
            <div
              style={{ height }}
              className="flex items-center justify-center text-sm text-text-secondary dark:text-text-secondary-dark"
            >
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height={`${height}px`}
            language={language}
            theme={isDarkMode ? "vs-dark" : "light"}
            value={value}
            onChange={(next) => onChange(next ?? "")}
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
              ariaLabel: label,
            }}
          />
        </Suspense>
      </div>
    </FormField>
  );
}

/** A GraphQL request: the query, its variables as JSON, and an optional operation name. */
export function GraphqlBodyEditor({
  graphql,
  isDarkMode,
  onChange,
}: GraphqlBodyEditorProps) {
  const current: GraphqlBody = graphql ?? { query: "" };
  const update = (patch: Partial<GraphqlBody>) =>
    onChange({ ...current, ...patch });
  return (
    <div className="space-y-4">
      <CodeField
        label="Query"
        hint="Sent as JSON {query, variables, operationName}, or as query parameters for GET. A response with an errors array still answers 200: assert response.body.errors not exists to fail on it."
        language="graphql"
        height={288}
        value={current.query}
        isDarkMode={isDarkMode}
        onChange={(query) => update({ query })}
      />
      <CodeField
        label="Variables"
        hint='A JSON object. A placeholder standing alone, as in "id": {{variables.userId}}, is inserted as a value.'
        error={jsonObjectTemplateProblem(current.variables ?? "")}
        language="json"
        height={160}
        value={current.variables ?? ""}
        isDarkMode={isDarkMode}
        onChange={(variables) => update({ variables })}
      />
      <FormField
        label="Operation name"
        hint="Optional: which operation to run when the query defines several."
      >
        <Input
          value={current.operationName ?? ""}
          onChange={(event) => update({ operationName: event.target.value })}
          className="font-mono"
        />
      </FormField>
    </div>
  );
}
