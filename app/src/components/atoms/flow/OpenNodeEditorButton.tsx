import type { OpenNodeEditorButtonProps } from "../../../types/OpenNodeEditorButtonProps";

/**
 * Opens a node's full editor from inside the node body.
 *
 * The canvas opens the modal on double-click, and that listener lives on the
 * ReactFlow node wrapper rather than on anything this component can call, so
 * the button synthesises the event the canvas is already listening for. It is a
 * real `<button>` so the affordance is keyboard-reachable, which a bare
 * double-click target is not.
 */
export function OpenNodeEditorButton({
  nodeId,
  label,
  ariaLabel,
  className = "",
}: OpenNodeEditorButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        const node = document.querySelector(
          `[data-id="${nodeId}"]`,
        ) as HTMLElement | null;
        node?.dispatchEvent(
          new MouseEvent("dblclick", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }}
      className={[
        "nodrag cursor-pointer text-[var(--aw-primary)] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );
}
