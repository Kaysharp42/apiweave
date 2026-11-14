import { describeLocator } from "@shared/browser/describe_locator";
import { BrowserAriaRoleSchema } from "@shared/zod-schemas/BrowserLocatorSchema";
import type { BrowserAriaRole } from "@shared/types/BrowserAriaRole";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { Toggle } from "../atoms/Toggle";
import { FormField } from "./FormField";
import { TemplateInput } from "./TemplateAutocomplete";
import type { BrowserLocatorEditorProps } from "../../types/BrowserLocatorEditorProps";

type LocatorKind = BrowserLocator["kind"];

/** How the element is found, in the order a person should prefer them. */
const KINDS: readonly { readonly value: LocatorKind; readonly label: string; readonly hint: string }[] = [
  { value: "role", label: "Role and name", hint: "What it is (button, link, textbox…) and the name a screen reader announces. The most robust choice." },
  { value: "label", label: "Field label", hint: "The label text of a form field." },
  { value: "placeholder", label: "Placeholder", hint: "The grey hint text inside an empty field." },
  { value: "text", label: "Visible text", hint: "Text shown on the element." },
  { value: "testId", label: "Test id", hint: "The element's data-testid attribute, if developers added one." },
  { value: "alt", label: "Image alt text", hint: "The alt text of an image." },
  { value: "title", label: "Title attribute", hint: "The tooltip text in the element's title attribute." },
  { value: "css", label: "CSS selector", hint: "Use only when nothing above names the element: it breaks when the page's markup changes." },
];

const ROLES: readonly BrowserAriaRole[] = BrowserAriaRoleSchema.options;

/** The modifiers every kind keeps when the kind changes. */
function modifiersOf(locator: BrowserLocator): Pick<BrowserLocator, "hasText" | "nth" | "within" | "frame"> {
  return {
    ...(locator.hasText !== undefined ? { hasText: locator.hasText } : {}),
    ...(locator.nth !== undefined ? { nth: locator.nth } : {}),
    ...(locator.within !== undefined ? { within: locator.within } : {}),
    ...(locator.frame !== undefined ? { frame: locator.frame } : {}),
  };
}

/** The text a kind matches on, carried over when the kind changes so the user does not retype it. */
function textOf(locator: BrowserLocator): string {
  return locator.kind === "role" ? (locator.name ?? "") : locator.value;
}

function withKind(locator: BrowserLocator, kind: LocatorKind): BrowserLocator {
  const kept = modifiersOf(locator);
  if (kind === "role") return { kind: "role", role: "button", name: textOf(locator), ...kept };
  return { kind, value: textOf(locator), ...kept };
}

/** Drop an optional field when it is emptied, so the stored locator holds only what is set. */
function withOptional<K extends "hasText" | "frame">(locator: BrowserLocator, key: K, value: string): BrowserLocator {
  const next = { ...locator };
  if (value === "") delete next[key];
  else next[key] = value;
  return next;
}

/** `exact` on the kinds that have it; off is the default, so it is dropped rather than stored as false. */
function withExact(locator: BrowserLocator, exact: boolean): BrowserLocator {
  if (locator.kind === "testId" || locator.kind === "css" || locator.kind === "selector") return locator;
  const next = { ...locator };
  if (exact) next.exact = true;
  else delete next.exact;
  return next;
}

export function BrowserLocatorEditor({ locator, onChange, depth = 0 }: BrowserLocatorEditorProps) {
  const isRecorded = locator.kind === "selector";
  const kind = KINDS.find((entry) => entry.value === locator.kind);
  const hasExact = withExact(locator, true) !== locator;

  return (
    <div className="space-y-4">
      {isRecorded ? (
        <FormField label="Recorded selector" hint="The recorder could not describe this element in a better way. Choose another way to find it to replace it.">
          <Input value={locator.value} readOnly className="font-mono" />
        </FormField>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Find the element by" {...(kind ? { hint: kind.hint } : {})}>
          <Select value={locator.kind} onChange={(event) => {
            const next = KINDS.find((entry) => entry.value === event.target.value);
            if (next) onChange(withKind(locator, next.value));
          }}>
            {isRecorded ? <option value="selector">Recorded selector</option> : null}
            {KINDS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </Select>
        </FormField>

        {locator.kind === "role" ? (
          <FormField label="Role">
            <Select value={locator.role} onChange={(event) => {
              const role = ROLES.find((candidate) => candidate === event.target.value);
              if (role) onChange({ ...locator, role });
            }}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </Select>
          </FormField>
        ) : null}
      </div>

      {locator.kind === "role" ? (
        <FormField label="Name" hint="Leave empty to match any element with this role.">
          <TemplateInput
            value={locator.name ?? ""}
            onValueChange={(name) => {
              const next = { ...locator };
              if (name === "") delete next.name;
              else next.name = name;
              onChange(next);
            }}
            placeholder="Sign in"
          />
        </FormField>
      ) : !isRecorded ? (
        <FormField label={kind?.label ?? "Value"}>
          <TemplateInput value={locator.value} onValueChange={(value) => onChange({ ...locator, value })} className={locator.kind === "css" ? "font-mono" : ""} />
        </FormField>
      ) : null}

      {hasExact ? (
        <Toggle
          label="Match the whole text exactly (otherwise any part, ignoring case)"
          checked={"exact" in locator && locator.exact === true}
          onChange={(event) => onChange(withExact(locator, event.target.checked))}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Only if it contains text" hint="Narrows several matches to the one with this text.">
          <TemplateInput value={locator.hasText ?? ""} onValueChange={(value) => onChange(withOptional(locator, "hasText", value))} placeholder="Row B" />
        </FormField>
        <FormField label="Which match" hint="When several elements match: 0 is the first, -1 the last.">
          <Input
            type="number"
            min={-1}
            max={1000}
            value={locator.nth ?? ""}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              const next = { ...locator };
              if (Number.isInteger(parsed) && parsed >= -1) next.nth = parsed;
              else delete next.nth;
              onChange(next);
            }}
            placeholder="any (must be unique)"
            className="max-w-40 font-mono"
          />
        </FormField>
        <FormField label="Inside the frame" hint="CSS selector of the iframe, when the element is in one." className="md:col-span-2">
          <Input value={locator.frame ?? ""} onChange={(event) => onChange(withOptional(locator, "frame", event.target.value))} placeholder="iframe#payment" className="font-mono" />
        </FormField>
      </div>

      {locator.within !== undefined ? (
        <div className="space-y-3 rounded-xs border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
          <p className="text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">Inside this element</p>
          <BrowserLocatorEditor locator={locator.within} onChange={(within) => onChange({ ...locator, within })} depth={depth + 1} />
          <Button variant="ghost" intent="error" size="xs" onClick={() => {
            const next = { ...locator };
            delete next.within;
            onChange(next);
          }}>
            Search the whole page instead
          </Button>
        </div>
      ) : depth < 2 ? (
        <Button variant="secondary" size="sm" onClick={() => onChange({ ...locator, within: { kind: "role", role: "listitem" } })}>
          Search inside another element
        </Button>
      ) : null}

      {depth === 0 ? (
        <p className="break-all font-mono text-xs text-text-secondary dark:text-text-secondary-dark">
          page.{describeLocator(locator)}
        </p>
      ) : null}
    </div>
  );
}
