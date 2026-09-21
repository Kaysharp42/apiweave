import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { Input } from "../atoms/Input";
import { ScrollableNodeTextArea } from "../atoms/flow/ScrollableNodeTextArea";
import { useTemplateSuggestions } from "../../hooks/useTemplateSuggestions";
import {
  applyTemplateSuggestion,
  filterTemplateSuggestions,
  findTemplateToken,
} from "../../utils/templateAutocomplete";
import type { TemplateAutocompleteHandle } from "../../types/TemplateAutocompleteHandle";
import type { TemplateInputProps } from "../../types/TemplateInputProps";
import type { TemplateSuggestion } from "../../types/TemplateSuggestion";
import type { TemplateTextAreaProps } from "../../types/TemplateTextAreaProps";
import type { TemplateToken } from "../../types/TemplateToken";

/**
 * Autocomplete for `{{…}}` references, as props you spread onto a field.
 *
 * This replaces the cheat sheet that used to sit at the bottom of the HTTP
 * node — a static list of every workflow variable, which grew with the
 * workflow until the node was mostly documentation. The names belong where
 * they are typed.
 *
 * The popover is portalled and `position: fixed` because a node's slab is
 * `overflow-hidden` and the canvas is a transformed viewport: a list rendered
 * in the field's own subtree is clipped by the node it is helping with.
 * `getBoundingClientRect` already reports post-transform screen coordinates,
 * so the anchoring needs no knowledge of the canvas zoom.
 */

const MIN_WIDTH = 280;
const VIEWPORT_MARGIN = 8;
const GAP = 4;
/** Tall enough for ~7 rows; past that the list scrolls. */
const MAX_HEIGHT = 224;
/** Never smaller than this, even in a cramped corner — two rows and a hint. */
const MIN_HEIGHT = 80;

const KIND_LABEL: Record<TemplateSuggestion["kind"], string> = {
  variable: "var",
  env: "env",
  secret: "secret",
  response: "prev",
  function: "fn",
};

const KIND_CLASS: Record<TemplateSuggestion["kind"], string> = {
  variable: "text-[var(--aw-status-success)]",
  env: "text-[var(--aw-primary)]",
  secret: "text-[var(--aw-status-warning)]",
  response: "text-[var(--aw-status-info)]",
  function: "text-text-muted dark:text-text-muted-dark",
};

export function useTemplateAutocomplete<
  E extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement,
>(
  value: string,
  onValueChange: (next: string) => void,
): TemplateAutocompleteHandle<E> {
  const suggestions = useTemplateSuggestions();
  const fieldRef = useRef<E>(null);
  const listId = useId();
  const [token, setToken] = useState<TemplateToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Where the caret goes once the accepted text has come back through the
  // parent's state. Set during accept, consumed on the next paint.
  const pendingCaret = useRef<number | null>(null);

  const matches = useMemo(
    () => (token ? filterTemplateSuggestions(token.query, suggestions) : []),
    [token, suggestions],
  );
  const isOpen = token !== null && matches.length > 0;

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const field = fieldRef.current;
    if (caret === null || !field) return;
    pendingCaret.current = null;
    field.focus();
    field.setSelectionRange(caret, caret);
  }, [value]);

  // Same token, same object — otherwise every caret move through a reference
  // re-renders the list for a query that has not changed.
  const syncToken = useCallback((field: E): void => {
    const next = findTemplateToken(
      field.value,
      field.selectionStart ?? field.value.length,
    );
    setToken((current) =>
      current?.start === next?.start && current?.query === next?.query
        ? current
        : next,
    );
    setActiveIndex(0);
  }, []);

  const accept = useCallback(
    (suggestion: TemplateSuggestion): void => {
      const field = fieldRef.current;
      if (!field || !token) return;
      const edit = applyTemplateSuggestion(
        field.value,
        field.selectionStart ?? field.value.length,
        token,
        suggestion,
      );
      pendingCaret.current = edit.caret;
      setToken(null);
      onValueChange(edit.text);
    },
    [token, onValueChange],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<E>): void => {
      if (!isOpen) return;

      // Every handled key is also stopped: the canvas listens for its own
      // shortcuts on the document, and Enter in a textarea would otherwise
      // insert a newline behind the accepted reference.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : matches.length - 1;
        setActiveIndex((current) => (current + step) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        accept(matches[activeIndex] ?? matches[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setToken(null);
      }
    },
    [isOpen, matches, activeIndex, accept],
  );

  return {
    props: {
      ref: fieldRef,
      value,
      onChange: (event: ChangeEvent<E>) => {
        onValueChange(event.target.value);
        syncToken(event.target);
      },
      onSelect: (event: SyntheticEvent<E>) => syncToken(event.currentTarget),
      onBlur: () => setToken(null),
      onKeyDown,
      "aria-autocomplete": "list",
      "aria-expanded": isOpen,
      "aria-controls": isOpen ? listId : undefined,
      "aria-activedescendant": isOpen ? `${listId}-${activeIndex}` : undefined,
    },
    list: isOpen ? (
      <SuggestionList
        id={listId}
        anchor={fieldRef.current}
        matches={matches}
        activeIndex={activeIndex}
        onPick={accept}
      />
    ) : null,
  };
}

/**
 * A textarea whose `{{…}}` references complete themselves. Drop-in for the
 * plain one: same attributes, except the text arrives via `onValueChange`.
 */
export function TemplateTextArea({
  value,
  onValueChange,
  scrollable = false,
  ...rest
}: TemplateTextAreaProps) {
  const { props, list } = useTemplateAutocomplete<HTMLTextAreaElement>(
    value,
    onValueChange,
  );
  return (
    <>
      {scrollable ? (
        <ScrollableNodeTextArea {...rest} {...props} />
      ) : (
        <textarea {...rest} {...props} />
      )}
      {list}
    </>
  );
}

/** The {@link Input} atom, with the same completion. */
export function TemplateInput({
  value,
  onValueChange,
  ...rest
}: TemplateInputProps) {
  const { props, list } = useTemplateAutocomplete<HTMLInputElement>(
    value,
    onValueChange,
  );
  return (
    <>
      <Input {...rest} {...props} />
      {list}
    </>
  );
}

interface SuggestionListProps {
  readonly id: string;
  readonly anchor: HTMLElement | null;
  readonly matches: readonly TemplateSuggestion[];
  readonly activeIndex: number;
  readonly onPick: (suggestion: TemplateSuggestion) => void;
}

function SuggestionList({
  id,
  anchor,
  matches,
  activeIndex,
  onPick,
}: SuggestionListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Measured every render rather than held in state: the list re-renders on
  // each keystroke anyway, and the anchor can have moved (a node textarea
  // grows as you type) between one keystroke and the next.
  const rect = anchor?.getBoundingClientRect();

  useLayoutEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    // jsdom has no scrollIntoView; the optional call keeps tests off the floor.
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!rect) return null;

  const width = Math.min(
    Math.max(rect.width, MIN_WIDTH),
    window.innerWidth - 2 * VIEWPORT_MARGIN,
  );
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left),
    window.innerWidth - width - VIEWPORT_MARGIN,
  );
  // Below the field unless there is no usable room there, and never taller
  // than the space it has — a node near the bottom of a zoomed-in canvas has
  // very little of either. Flipping above pins the list's *bottom* to the
  // field rather than computing a top from a height it does not have yet: a
  // short list anchored by its top would float away from the field it belongs
  // to, by exactly the height it did not use.
  const spaceBelow = window.innerHeight - VIEWPORT_MARGIN - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
  const placeBelow = spaceBelow >= MIN_HEIGHT || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(
    MIN_HEIGHT,
    Math.min(MAX_HEIGHT, placeBelow ? spaceBelow : spaceAbove),
  );
  const verticalAnchor = placeBelow
    ? { top: rect.bottom + GAP }
    : { bottom: window.innerHeight - rect.top + GAP };

  return createPortal(
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Reference suggestions"
      className="fixed z-[60] overflow-y-auto rounded-md border border-border bg-surface-raised py-1 shadow-[var(--aw-shadow-popover)] dark:border-border-dark dark:bg-surface-dark-raised"
      style={{ ...verticalAnchor, left, width, maxHeight }}
    >
      {matches.map((suggestion, index) => (
        <li key={suggestion.insert}>
          <button
            type="button"
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            data-active={index === activeIndex}
            // The field must keep focus and its caret: a blur here would close
            // the list before the click that opened it ever lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(suggestion)}
            className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs ${
              index === activeIndex
                ? "bg-[color-mix(in_srgb,var(--aw-primary)_12%,transparent)]"
                : ""
            }`}
          >
            <span
              className={`w-10 flex-shrink-0 font-mono text-[10px] uppercase ${KIND_CLASS[suggestion.kind]}`}
            >
              {KIND_LABEL[suggestion.kind]}
            </span>
            <span className="flex-shrink-0 font-mono text-text-primary dark:text-text-primary-dark">
              {suggestion.insert}
            </span>
            {suggestion.detail && (
              <span className="truncate text-text-muted dark:text-text-muted-dark">
                {suggestion.detail}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
