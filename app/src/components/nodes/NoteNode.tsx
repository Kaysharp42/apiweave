import { memo } from "react";
import { Pin, StickyNote } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { TextArea } from "../atoms/TextArea";
import { useNodeConfigPatch } from "../../hooks/useNodeConfigPatch";
import type { CanvasNode } from "../../types/CanvasNode";
import type { NodeProps } from "@xyflow/react";

/**
 * A note is a canvas object, not a step: it has no details dialog, so both its
 * title and its body are edited in place here (`onNodeDoubleClick` skips it).
 */
function NoteNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData } = useReactFlow<CanvasNode>();
  const patchConfig = useNodeConfigPatch(id);
  const content = typeof data.config?.content === "string" ? data.config.content : "";
  const title = typeof data.label === "string" ? data.label : "";
  const label = title.trim() || "Note";

  return (
    <article
      aria-label={`Canvas note: ${label}`}
      className={[
        "relative w-[236px] overflow-visible rounded-[3px] border border-[color-mix(in_srgb,var(--aw-status-warning)_48%,var(--aw-border))] bg-[color-mix(in_srgb,var(--aw-status-warning)_13%,var(--aw-surface-raised))] shadow-node transition-[box-shadow,transform] duration-aw-fast ease-aw-standard motion-reduce:transition-none",
        "before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-[color-mix(in_srgb,var(--aw-surface-raised)_80%,transparent)]",
        selected ? "shadow-glow-select" : "rotate-[0.35deg]",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="absolute -top-2 left-8 h-4 w-16 -rotate-2 border-x border-[color-mix(in_srgb,var(--aw-status-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--aw-status-warning)_32%,transparent)]"
      />
      <span
        aria-hidden="true"
        className="absolute -top-3 right-5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--aw-status-warning)_65%,var(--aw-border))] bg-surface-raised text-[var(--aw-status-warning)] shadow-node"
      >
        <Pin className="h-3.5 w-3.5" />
      </span>
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 h-9 w-9 border-b border-l border-[color-mix(in_srgb,var(--aw-status-warning)_38%,var(--aw-border))] bg-[color-mix(in_srgb,var(--aw-status-warning)_22%,var(--aw-surface-overlay))] [clip-path:polygon(100%_0,0_0,100%_100%)]"
      />

      <header className="flex items-center gap-2 border-b border-dashed border-[color-mix(in_srgb,var(--aw-status-warning)_42%,var(--aw-border))] px-4 py-3 pr-12">
        <StickyNote className="h-3.5 w-3.5 text-[var(--aw-status-warning)]" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary dark:text-text-secondary-dark">
          Annotation
        </span>
      </header>

      <div className="relative px-4 pb-4 pt-3">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-12 space-y-6">
          <div className="border-b border-[color-mix(in_srgb,var(--aw-text-muted)_18%,transparent)]" />
          <div className="border-b border-[color-mix(in_srgb,var(--aw-text-muted)_18%,transparent)]" />
          <div className="border-b border-[color-mix(in_srgb,var(--aw-text-muted)_18%,transparent)]" />
        </div>
        <input
          className="nodrag relative z-10 mb-1.5 w-full truncate border-0 bg-transparent p-0 font-display text-sm font-bold tracking-[-0.01em] text-text-primary outline-none placeholder:font-normal placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-text-primary-dark"
          value={title}
          onChange={(event) => updateNodeData(id, { label: event.target.value })}
          placeholder="Note"
          title={label}
          aria-label="Note title"
        />
        <TextArea
          size="xs"
          className="nodrag relative z-10 min-h-24 resize-y !border-0 !bg-transparent !px-0 !py-0 font-mono leading-6"
          value={content}
          onChange={(event) => patchConfig("content", event.target.value)}
          placeholder="Write the context this branch needs..."
          aria-label={`Content for ${label}`}
        />
      </div>
    </article>
  );
}

export default memo(NoteNode);
