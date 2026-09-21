import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";

/**
 * What `useTemplateAutocomplete` hands back: props to spread onto an existing
 * field, and the popover to render beside it.
 *
 * It is a spread rather than a wrapper component so a field keeps its own
 * element, styling and layout — the node's textareas, the modal's `Input`s and
 * the key/value rows all look exactly as they did.
 */
export interface TemplateAutocompleteHandle<
  E extends HTMLInputElement | HTMLTextAreaElement,
> {
  readonly props: {
    readonly ref: RefObject<E>;
    readonly value: string;
    readonly onChange: (event: ChangeEvent<E>) => void;
    readonly onSelect: (event: SyntheticEvent<E>) => void;
    readonly onKeyDown: (event: KeyboardEvent<E>) => void;
    readonly onBlur: () => void;
    readonly "aria-autocomplete": "list";
    readonly "aria-expanded": boolean;
    readonly "aria-controls": string | undefined;
    readonly "aria-activedescendant": string | undefined;
  };
  /** Portals itself to the body; render it anywhere inside the field's JSX. */
  readonly list: ReactNode;
}
