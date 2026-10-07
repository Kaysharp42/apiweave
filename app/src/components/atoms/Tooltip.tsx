import { cloneElement, useState, type HTMLProps, type Ref } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from "@floating-ui/react";
import type { TooltipProps } from "../../types";

/**
 * Hover/focus tooltip on @floating-ui/react (already shipped with Headless
 * UI). The child is the reference element, so — as with any positioned
 * popover — it must be a DOM element or a component that forwards its ref.
 */
export function Tooltip({
  children,
  content,
  placement = "top",
  delay = 300,
  disabled = false,
  className = "",
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: delay, close: 0 }, move: false }),
    useFocus(context),
    useDismiss(context, { referencePress: true }),
    useRole(context, { role: "tooltip" }),
  ]);
  const childRef = (children as { ref?: Ref<Element> }).ref;
  const ref = useMergeRefs([refs.setReference, childRef]);

  if (!content || disabled) return children;

  return (
    <>
      {cloneElement(
        children,
        getReferenceProps({ ...(children.props as HTMLProps<Element>), ref }),
      )}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={[
              "z-[9999] max-w-xs rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised px-2 py-1 font-sans text-xs text-text-primary dark:text-text-primary-dark shadow-popover",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
