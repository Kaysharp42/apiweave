import { useEffect, useRef, useState } from "react";

/**
 * Load the choices for a `<select>` that only exists while a dialog is open.
 *
 * Every select in the move dialogs needs the same three things: fetch when the
 * dialog opens, discard an answer that arrives after it closed or after the
 * thing it was keyed on changed, and expose a loading flag for the gap.
 *
 * `key` carries both the trigger and the gate: `null` means "nothing to load"
 * — a closed dialog and an unmet precondition (no destination picked yet) take
 * the same path — and any change re-fetches. The fetcher is read through a ref
 * so callers can pass an inline closure without it counting as a dependency.
 */
export function useAsyncOptions<T>(
  key: string | null,
  fetch: (key: string) => Promise<readonly T[]>,
): { readonly options: readonly T[]; readonly isLoading: boolean } {
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const [options, setOptions] = useState<readonly T[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (key === null) {
      setOptions([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void fetchRef
      .current(key)
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { options, isLoading };
}
