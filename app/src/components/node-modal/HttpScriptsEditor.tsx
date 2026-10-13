import { Suspense } from "react";
import { BookOpen, SquareCode, type LucideIcon } from "lucide-react";
import { Input } from "../atoms/Input";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { TutorialCodeBlock } from "../molecules/TutorialCodeBlock";
import { MonacoEditor } from "./lazyMonaco";
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  MAX_SCRIPT_TIMEOUT_MS,
} from "@shared/zod-schemas/HttpScriptsConfigSchema";
import type { HttpScriptsConfig } from "@shared/types/HttpScriptsConfig";
import type { HttpScriptsEditorProps } from "../../types";

function cardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const ScriptCardIcon = cardIcon(SquareCode);
const ReferenceCardIcon = cardIcon(BookOpen);

/** The `aw` API, one line each. The full reference is docs/features/scripting.md. */
const API_REFERENCE: readonly (readonly [string, string])[] = [
  ["aw.request", "Pre-request: { method, url, headers, body }, resolved and mutable. What you leave is what is sent."],
  ["aw.response", "Post-response: status, headers, body, responseTime, header(name), json(), text()."],
  ["aw.variables.get(name) / .set(name, value)", "Workflow variables; later nodes read {{variables.name}}. Values must be JSON."],
  ["aw.env.get(name)", "The selected environment's variables."],
  ["aw.data.get(column)", "The current row of a data-driven run."],
  ["aw.secrets.get(\"NAME\")", "A secret, named literally so the run resolves it up front. Masked in results and logs."],
  ["aw.test(name, fn)", "A named check: passes unless fn throws. A failed test fails the node."],
  ["aw.expect(value)", ".toBe .toEqual .toContain .toMatch .toBeGreaterThan .toBeLessThan .toBeTruthy .toBeDefined, and .not"],
  ["aw.crypto", "hmacSha256(key, text, \"hex\"|\"base64\"|\"base64url\", keyEncoding), sha256(text, encoding), base64Encode, base64Decode, uuid()"],
  ["console.log(...)", "Captured into the node's result (first 100 lines)."],
];

const PRE_REQUEST_EXAMPLE = {
  caption: "Sign the request",
  language: "text" as const,
  code: `const timestamp = String(Date.now())
const signature = aw.crypto.hmacSha256(
  aw.secrets.get("SIGNING_KEY"),
  timestamp + aw.request.method + aw.request.url + (aw.request.body ?? ""),
)
aw.request.headers["X-Timestamp"] = timestamp
aw.request.headers["X-Signature"] = signature`,
};

const POST_RESPONSE_EXAMPLE = {
  caption: "Check the response and keep a value",
  language: "text" as const,
  code: `const order = aw.response.json()
aw.test("order is confirmed", () => aw.expect(order.status).toBe("confirmed"))
aw.test("total is positive", () => aw.expect(order.total).toBeGreaterThan(0))
aw.variables.set("orderId", order.id)`,
};

function ScriptEditor({
  label,
  hint,
  value,
  isDarkMode,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  isDarkMode: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} hint={hint}>
      <div className="overflow-hidden rounded-sm border border-border dark:border-border-dark">
        <Suspense
          fallback={
            <div className="flex h-60 items-center justify-center text-sm text-text-secondary dark:text-text-secondary-dark">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="240px"
            language="javascript"
            theme={isDarkMode ? "vs-dark" : "light"}
            value={value}
            onChange={(next) => onChange(next ?? "")}
            options={{
              minimap: { enabled: false },
              fontFamily: "JetBrains Mono",
              scrollBeyondLastLine: false,
              tabSize: 2,
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

/**
 * The request's pre-request and post-response scripts: synchronous JavaScript
 * run by the runner in a sandbox, with the `aw` API listed beside them.
 */
export function HttpScriptsEditor({ scripts, isDarkMode, onChange }: HttpScriptsEditorProps) {
  const update = (patch: Partial<HttpScriptsConfig>) => onChange({ ...scripts, ...patch });
  return (
    <div className="space-y-4">
      <Card title="Scripts" icon={ScriptCardIcon} className="overflow-visible">
        <div className="space-y-4">
          <ScriptEditor
            label="Pre-request script"
            hint="Runs after placeholders are resolved, just before the request is sent. Change aw.request to sign or rewrite it."
            value={scripts?.preRequest ?? ""}
            isDarkMode={isDarkMode}
            onChange={(preRequest) => update({ preRequest })}
          />
          <ScriptEditor
            label="Post-response script"
            hint="Runs once the response arrives (after any retries). Read aw.response, set variables, and check it with aw.test."
            value={scripts?.postResponse ?? ""}
            isDarkMode={isDarkMode}
            onChange={(postResponse) => update({ postResponse })}
          />
          <FormField
            label="Time limit"
            hint={`Milliseconds each script may run, 1 to ${MAX_SCRIPT_TIMEOUT_MS}. Scripts are synchronous: no await, timers or network.`}
          >
            <Input
              type="number"
              min={1}
              max={MAX_SCRIPT_TIMEOUT_MS}
              value={scripts?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS}
              onChange={(event) => update({ timeoutMs: Number(event.target.value) || DEFAULT_SCRIPT_TIMEOUT_MS })}
            />
          </FormField>
        </div>
      </Card>

      <Card title="Script API" icon={ReferenceCardIcon} collapsible>
        <div className="space-y-4">
          <dl className="space-y-2">
            {API_REFERENCE.map(([signature, description]) => (
              <div key={signature} className="grid gap-1 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-3">
                <dt className="font-mono text-xs text-primary dark:text-primary-light">{signature}</dt>
                <dd className="text-xs text-text-secondary dark:text-text-secondary-dark">{description}</dd>
              </div>
            ))}
          </dl>
          <TutorialCodeBlock example={PRE_REQUEST_EXAMPLE} />
          <TutorialCodeBlock example={POST_RESPONSE_EXAMPLE} />
        </div>
      </Card>
    </div>
  );
}
