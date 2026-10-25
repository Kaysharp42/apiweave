import { useEffect, useRef, useState } from "react";
import { parseValueText } from "../utils/mergeValues";
import type { MergeValueDraft, UseMergeValueDraftOptions } from "../types";

/**
 * The text a result is being written as, and what an edit decides. A text field
 * takes its text as the value; anything else is parsed as JSON. Empty or
 * unparseable text drops the field's decision, so a Finish cannot carry a value
 * the user could not read, and the error is said in place.
 *
 * The text follows the value when a pick is made elsewhere (an arrow, an
 * accept-all, a redo), but not when the change is the echo of the edit that
 * made it, which would move the caret under the user's hands.
 */
export function useMergeValueDraft({
  shown,
  textValue,
  onChange,
  onClear,
  onInvalidChange,
}: UseMergeValueDraftOptions): MergeValueDraft {
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const echoing = useRef(false);
  const lastShown = useRef(shown);

  useEffect(() => {
    if (shown === lastShown.current) return;
    lastShown.current = shown;
    if (echoing.current) {
      echoing.current = false;
      return;
    }
    setText(shown);
    setError(null);
    onInvalidChange(false);
  }, [shown]);

  const clear = (message: string | null): void => {
    setError(message);
    echoing.current = true;
    onClear();
    onInvalidChange(message !== null);
  };

  const commit = (next: string): void => {
    setText(next);
    if (textValue) {
      if (next === "") {
        clear(null);
        return;
      }
      setError(null);
      echoing.current = true;
      onChange(next);
      onInvalidChange(false);
      return;
    }
    if (next.trim() === "") {
      clear(null);
      return;
    }
    const parsed = parseValueText(next);
    if ("error" in parsed) {
      clear(parsed.error);
      return;
    }
    setError(null);
    echoing.current = true;
    onChange(parsed.value);
    onInvalidChange(false);
  };

  return { text, error, commit };
}
