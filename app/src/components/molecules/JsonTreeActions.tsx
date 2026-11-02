import type { ReactNode } from "react";
import { toPathString, type CustomButtonDefinition } from "json-edit-react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * The hover-row actions in a JSON tree are the only place in the app where a
 * bare icon has to carry a whole feature -- "save this value as a variable" is
 * not something any glyph says on its own. So they are labelled chips, not
 * icons: the row reveals them on hover (`.jer-edit-buttons`), so the words cost
 * nothing until someone is already looking at that row.
 *
 * `font-sans` is not decoration: the tree sets a monospace family on the whole
 * subtree, and prose in JetBrains Mono at 11px is what makes these read as
 * debug output instead of buttons.
 */
export function JsonTreeActionPill({
  icon,
  label,
  muted = false,
}: {
  icon: ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[11px] font-medium leading-none tracking-normal whitespace-nowrap transition-colors ${
        muted
          ? "bg-surface-overlay text-text-secondary hover:bg-border/60 dark:bg-surface-dark-overlay dark:text-text-secondary-dark"
          : "bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary-light/15 dark:text-primary-light dark:hover:bg-primary-light/25"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

function copyText(text: string): void {
  if (!navigator.clipboard) {
    toast.error("Could not copy to clipboard");
    return;
  }
  navigator.clipboard.writeText(text).catch(() => {
    toast.error("Could not copy to clipboard");
  });
}

function CopyValueButton() {
  return (
    <span className="jer-icon flex items-center">
      <JsonTreeActionPill
        icon={<Copy className="h-3 w-3" aria-hidden="true" />}
        label="Copy"
        muted
      />
    </span>
  );
}

/**
 * json-edit-react's built-in clipboard control is an unlabelled glyph, and v2
 * moved icon glyphs into the theme where they can only be SVGs. A richer,
 * labelled control belongs in `customButtons` instead; pair this with
 * `showClipboardButton={false}` so the tree renders one copy action, not two.
 */
export const JSON_TREE_COPY_BUTTON: CustomButtonDefinition = {
  Element: CopyValueButton,
  label: "Copy to clipboard",
  onClick: (nodeData, event) => {
    const copyPath = event.metaKey || event.ctrlKey;
    const value = copyPath
      ? toPathString(nodeData.path)
      : typeof nodeData.value === "object" && nodeData.value !== null
        ? JSON.stringify(nodeData.value, null, 2)
        : String(nodeData.value);
    copyText(value);
  },
};

/**
 * The library scales its hover buttons 1.2x, which reads as a wobble once they
 * carry text. Applied on the tree's scroll container.
 */
export const JSON_TREE_ACTION_RESET =
  "[&_.jer-icon:hover]:transform-none [&_.jer-icon:hover]:opacity-100 [&_.jer-edit-buttons]:gap-1.5 [&_.jer-edit-buttons]:ml-2";
